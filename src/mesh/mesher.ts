/**
 * Greedy chunk mesher: padded voxel data → per-bucket vertex/index geometry.
 *
 * Visibility is computed with bitwise set algebra ("binary greedy meshing")
 * instead of per-cell neighbor probing. The padded interior is scanned once,
 * accumulating two families of 32-bit occupancy columns over the x-normal
 * tangent plane — bit `a` of a column is the cell at coordinate `a` along the
 * normal axis:
 *
 *   meshable — interior cell whose stateId is neither AIR nor BOUNDARY
 *   occluder — BOUNDARY or an opaque material class (hides neighbor faces)
 *
 * The y- and z-normal families are derived from the x family with 32×32 bit
 * transposes instead of per-cell scattered writes. `nonAir` needs no third
 * family: every non-air interior cell is BOUNDARY (occluder) or meshable, so
 * nonAir = meshable | occluder. Tangent positions span the full padded plane
 * (-1..32, stored at +1 offsets) so ambient occlusion can sample shell cells
 * from the same tables; a short second pass classifies the padded shell into
 * those tangent-shell columns plus per-axis occluder / nonAir tables for the
 * two layers at -1 and 32 along the normal axis, which do not fit the 32-bit
 * columns.
 *
 * A face toward +normal is visible when an opaque cell has no occluder ahead,
 * or a transparent cell has air ahead, which collapses to one expression per
 * column:
 *
 *   opaqueMeshable      = meshable & occluder
 *   transparentMeshable = meshable & ~occluder
 *   visiblePositive     = (opaqueMeshable      & ~((occluder >>> 1) | (shellHighOccluder << 31)))
 *                       | (transparentMeshable & ~((nonAir   >>> 1) | (shellHighNonAir   << 31)))
 *
 * and the mirrored form with `<< 1` plus the low shell bits for -normal. The
 * same shift aligns the eight surrounding columns with the face layer, so the
 * four AO corner terms per face are single bit extractions, and faces whose
 * aligned neighborhood is empty skip the corner math entirely. Visible bits
 * are transposed into per-layer row masks (work proportional to visible
 * faces, found via count-trailing-zeros), where the greedy maximal-rectangle
 * merge consumes them. AO is packed next to the stateId so merging only joins
 * cells with identical shading.
 *
 * Hot loops allocate nothing: builders are pooled across calls, grow
 * geometrically, and only the exact-size output slices are freshly allocated.
 * The pipeline is split into per-phase functions so each stays within the
 * JIT's optimizing-compile budget, and per-vertex attribute bytes are written
 * as endian-correct 32-bit words.
 *
 * Block shapes: only SHAPE_CUBE voxels participate in the column masks — a
 * non-cube voxel acts as air toward its neighbors (no occlusion, no AO, no
 * nonAir). The occupancy scan collects non-cube voxels into a scratch list;
 * after the greedy pass they are emitted per voxel from the SHAPE_FACES
 * templates. A template face lying on a cell-boundary plane is culled only
 * against BOUNDARY or an opaque-class full cube behind that plane, while
 * interior faces (slab mid-planes, ramp slopes) always draw.
 */

import type { BucketGeometry, ChunkGeometry } from "../core/types";
import {
  AIR,
  BOUNDARY,
  CHUNK_SIZE,
  FACE_NORMAL,
  PAD,
  SHAPE_CUBE,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
} from "../core/types";

/** Normal axis id per face direction (0:+x 1:-x 2:+y 3:-y 4:+z 5:-z). */
const NORMAL_AXIS = Uint8Array.of(0, 0, 1, 1, 2, 2);
/** Tangent axes picked so u×w equals the outward face normal (CCW winding). */
const TANGENT_U_AXIS = Uint8Array.of(1, 2, 2, 0, 0, 1);
const TANGENT_W_AXIS = Uint8Array.of(2, 1, 0, 2, 1, 0);
/** Padded-array element stride per axis (x, y, z). */
const AXIS_STRIDE = Int32Array.of(1, PAD * PAD, PAD);
/** Index of chunk-local (0,0,0) inside padded data. */
const ORIGIN = 1 + PAD + PAD * PAD;
/** Padded-index offset to the neighbor across each face. */
const FACE_OFFSET = Int32Array.of(1, -1, PAD * PAD, -(PAD * PAD), PAD, -PAD);
/** Column table addressing: (axis << AXIS_SHIFT) | ((t2+1) << T2_SHIFT) | (t1+1). */
const T2_SHIFT = 6;
const AXIS_SHIFT = 12;
const COLUMN_TABLE_SIZE = 3 << AXIS_SHIFT;

/** Per-axis occupancy columns over the padded tangent plane. */
const columnMeshable = new Int32Array(COLUMN_TABLE_SIZE);
const columnOccluder = new Int32Array(COLUMN_TABLE_SIZE);
/** Shell-layer (-1 / 32 along the axis) bits, same indexing as the columns. */
const shellLowOccluder = new Uint8Array(COLUMN_TABLE_SIZE);
const shellHighOccluder = new Uint8Array(COLUMN_TABLE_SIZE);
const shellLowNonAir = new Uint8Array(COLUMN_TABLE_SIZE);
const shellHighNonAir = new Uint8Array(COLUMN_TABLE_SIZE);

/** Pending visible faces for one direction: bit u, indexed (layer << 5) | w. */
const faceRowMask = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
/** (aoPack << 16) | stateId per visible face, indexed (layer << 10) | (w << 5) | u. */
const faceKeys = new Int32Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
/** Scratch for axis-addressed corner coordinates. */
const cornerPos = new Float32Array(3);
/** Scratch rows for the 32×32 bit transposes. */
const transposeScratch = new Int32Array(32);

/** Collected non-cube voxels for template emission: x | z<<5 | y<<10 | stateId<<15. */
let shapedVoxels = new Int32Array(1024);
let shapedVoxelCount = 0;

const pushShapedVoxel = (packed: number): void => {
  if (shapedVoxelCount === shapedVoxels.length) {
    const grown = new Int32Array(shapedVoxels.length << 1);
    grown.set(shapedVoxels);
    shapedVoxels = grown;
  }
  shapedVoxels[shapedVoxelCount++] = packed;
};

const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
/** Packs four bytes into one u32 so byte i of the stored word is bi. */
const packBytes4 = LITTLE_ENDIAN
  ? (b0: number, b1: number, b2: number, b3: number): number =>
      b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
  : (b0: number, b1: number, b2: number, b3: number): number =>
      (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
/** Shift that places a byte at lane 0 of a packed word. */
const BYTE0_SHIFT = LITTLE_ENDIAN ? 0 : 24;

/** Per-direction packed vertex normal (xyz ±127, w 0). */
const NORMAL_WORDS = new Int32Array(6);
for (let d = 0; d < 6; d++) {
  NORMAL_WORDS[d] = packBytes4(
    (FACE_NORMAL[d * 3] * 127) & 0xff,
    (FACE_NORMAL[d * 3 + 1] * 127) & 0xff,
    (FACE_NORMAL[d * 3 + 2] * 127) & 0xff,
    0,
  );
}

/** One template face of a non-cube shape. */
interface ShapeFace {
  /** Face id whose padded neighbor may cull this face, or -1 for interior faces. */
  cullFace: number;
  /** Packed i8x4 vertex normal (unit normal × 127). */
  normalWord: number;
  /** 3 (triangle) or 4 (quad) CCW-from-outside corners in the unit cell, 3 floats each. */
  positions: Float32Array;
  vertexCount: number;
}

const shapeFace = (cullFace: number, normal: number[], corners: number[]): ShapeFace => ({
  cullFace,
  normalWord: packBytes4(
    Math.round(normal[0] * 127) & 0xff,
    Math.round(normal[1] * 127) & 0xff,
    Math.round(normal[2] * 127) & 0xff,
    0,
  ),
  positions: Float32Array.from(corners),
  vertexCount: corners.length / 3,
});

const SQRT1_2 = Math.SQRT1_2;

/**
 * Template faces per shape id (SHAPE_CUBE is empty — full cubes go through the
 * greedy path). Slabs span half the cell along y; ramps are wedges whose top
 * surface rises along the named axis toward the named sign.
 */
const SHAPE_FACES: ShapeFace[][] = [];
SHAPE_FACES[SHAPE_CUBE] = [];
SHAPE_FACES[SHAPE_SLAB_BOTTOM] = [
  shapeFace(3, [0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
  shapeFace(-1, [0, 1, 0], [0, 0.5, 0, 0, 0.5, 1, 1, 0.5, 1, 1, 0.5, 0]),
  shapeFace(0, [1, 0, 0], [1, 0, 0, 1, 0.5, 0, 1, 0.5, 1, 1, 0, 1]),
  shapeFace(1, [-1, 0, 0], [0, 0, 0, 0, 0, 1, 0, 0.5, 1, 0, 0.5, 0]),
  shapeFace(4, [0, 0, 1], [0, 0, 1, 1, 0, 1, 1, 0.5, 1, 0, 0.5, 1]),
  shapeFace(5, [0, 0, -1], [0, 0, 0, 0, 0.5, 0, 1, 0.5, 0, 1, 0, 0]),
];
SHAPE_FACES[SHAPE_SLAB_TOP] = [
  shapeFace(2, [0, 1, 0], [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0]),
  shapeFace(-1, [0, -1, 0], [0, 0.5, 0, 1, 0.5, 0, 1, 0.5, 1, 0, 0.5, 1]),
  shapeFace(0, [1, 0, 0], [1, 0.5, 0, 1, 1, 0, 1, 1, 1, 1, 0.5, 1]),
  shapeFace(1, [-1, 0, 0], [0, 0.5, 0, 0, 0.5, 1, 0, 1, 1, 0, 1, 0]),
  shapeFace(4, [0, 0, 1], [0, 0.5, 1, 1, 0.5, 1, 1, 1, 1, 0, 1, 1]),
  shapeFace(5, [0, 0, -1], [0, 0.5, 0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0]),
];
SHAPE_FACES[SHAPE_RAMP_PX] = [
  shapeFace(3, [0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
  shapeFace(0, [1, 0, 0], [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1]),
  shapeFace(-1, [-SQRT1_2, SQRT1_2, 0], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0]),
  shapeFace(5, [0, 0, -1], [0, 0, 0, 1, 1, 0, 1, 0, 0]),
  shapeFace(4, [0, 0, 1], [0, 0, 1, 1, 0, 1, 1, 1, 1]),
];
SHAPE_FACES[SHAPE_RAMP_NX] = [
  shapeFace(3, [0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
  shapeFace(1, [-1, 0, 0], [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0]),
  shapeFace(-1, [SQRT1_2, SQRT1_2, 0], [1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1]),
  shapeFace(5, [0, 0, -1], [0, 0, 0, 0, 1, 0, 1, 0, 0]),
  shapeFace(4, [0, 0, 1], [0, 0, 1, 1, 0, 1, 0, 1, 1]),
];
SHAPE_FACES[SHAPE_RAMP_PZ] = [
  shapeFace(3, [0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
  shapeFace(4, [0, 0, 1], [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  shapeFace(-1, [0, SQRT1_2, -SQRT1_2], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0]),
  shapeFace(1, [-1, 0, 0], [0, 0, 0, 0, 0, 1, 0, 1, 1]),
  shapeFace(0, [1, 0, 0], [1, 0, 0, 1, 1, 1, 1, 0, 1]),
];
SHAPE_FACES[SHAPE_RAMP_NZ] = [
  shapeFace(3, [0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
  shapeFace(5, [0, 0, -1], [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]),
  shapeFace(-1, [0, SQRT1_2, SQRT1_2], [0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0]),
  shapeFace(1, [-1, 0, 0], [0, 0, 0, 0, 0, 1, 0, 1, 0]),
  shapeFace(0, [1, 0, 0], [1, 0, 0, 1, 1, 0, 1, 0, 1]),
];

/** Growable geometry accumulator for one render bucket, reused across calls. */
interface Builder {
  position: Float32Array;
  normal: Int8Array;
  color: Uint8Array;
  extra: Uint8Array;
  index: Uint32Array;
  normalWords: Int32Array;
  colorWords: Int32Array;
  extraWords: Int32Array;
  capacity: number;
  vertexCount: number;
  indexCount: number;
}

const builderPool: (Builder | undefined)[] = [];

const createBuilder = (): Builder => {
  const normal = new Int8Array(1024 * 4);
  const color = new Uint8Array(1024 * 4);
  const extra = new Uint8Array(1024 * 4);
  return {
    position: new Float32Array(1024 * 3),
    normal,
    color,
    extra,
    index: new Uint32Array(1536),
    normalWords: new Int32Array(normal.buffer),
    colorWords: new Int32Array(color.buffer),
    extraWords: new Int32Array(extra.buffer),
    capacity: 1024,
    vertexCount: 0,
    indexCount: 0,
  };
};

const growBuilder = (b: Builder): void => {
  const cap = b.capacity << 1;
  const position = new Float32Array(cap * 3);
  position.set(b.position);
  b.position = position;
  const normal = new Int8Array(cap * 4);
  normal.set(b.normal);
  b.normal = normal;
  b.normalWords = new Int32Array(normal.buffer);
  const color = new Uint8Array(cap * 4);
  color.set(b.color);
  b.color = color;
  b.colorWords = new Int32Array(color.buffer);
  const extra = new Uint8Array(cap * 4);
  extra.set(b.extra);
  b.extra = extra;
  b.extraWords = new Int32Array(extra.buffer);
  const index = new Uint32Array((cap * 3) >> 1);
  index.set(b.index);
  b.index = index;
  b.capacity = cap;
};

const finishBuilder = (b: Builder): BucketGeometry => ({
  position: b.position.slice(0, b.vertexCount * 3),
  normal: b.normal.slice(0, b.vertexCount * 4),
  color: b.color.slice(0, b.vertexCount * 4),
  extra: b.extra.slice(0, b.vertexCount * 4),
  index: b.index.slice(0, b.indexCount),
  vertexCount: b.vertexCount,
});

/** Returns the per-call builder for a bucket, reviving a pooled one on first use. */
const acquireBuilder = (builders: (Builder | null)[], bucket: number): Builder => {
  let bld = builders[bucket];
  if (bld === null) {
    const pooled = builderPool[bucket];
    if (pooled === undefined) {
      bld = createBuilder();
      builderPool[bucket] = bld;
    } else {
      bld = pooled;
    }
    bld.vertexCount = 0;
    bld.indexCount = 0;
    builders[bucket] = bld;
  }
  return bld;
};

/** True when every padded cell is AIR (cheap word scan; false negatives impossible). */
const isAllAir = (padded: Uint16Array): boolean => {
  if ((padded.byteOffset & 3) !== 0 || (padded.length & 1) !== 0) return false;
  const words = new Uint32Array(padded.buffer, padded.byteOffset, padded.length >> 1);
  let i = 0;
  for (const stop = words.length - 7; i < stop; i += 8) {
    if (
      (words[i] |
        words[i + 1] |
        words[i + 2] |
        words[i + 3] |
        words[i + 4] |
        words[i + 5] |
        words[i + 6] |
        words[i + 7]) !==
      0
    ) {
      return false;
    }
  }
  for (; i < words.length; i++) if (words[i] !== 0) return false;
  return true;
};

/** In-place 32×32 bit-matrix transpose (Hacker's Delight 7-3): word r bit c ↔ word c bit r. */
const transpose32 = (a: Int32Array): void => {
  let m = 0x0000ffff;
  for (let j = 16; j !== 0; j >>= 1, m ^= m << j) {
    for (let k = 0; k < 32; k = (k + j + 1) & ~j) {
      const t = ((a[k] >>> j) ^ a[k + j]) & m;
      a[k] ^= t << j;
      a[k + j] ^= t;
    }
  }
};

/** Scans the padded interior into the x-normal column family; returns 1 when anything is meshable. */
const buildInteriorColumns = (
  padded: Uint16Array,
  stateTable: Uint32Array,
  stateShapes: Uint8Array,
  classOpaque: Uint8Array,
): number => {
  let anyMeshable = 0;
  let lastStateId = -1;
  let lastOpaque = 0;
  let lastCube = 1;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      let cellIndex = ORIGIN + y * (PAD * PAD) + z * PAD;
      let occluderRow = 0;
      let meshableRow = 0;
      for (let x = 0; x < CHUNK_SIZE; x++, cellIndex++) {
        const v = padded[cellIndex];
        if (v === AIR) continue;
        if (v !== lastStateId) {
          lastStateId = v;
          lastCube = v === BOUNDARY || stateShapes[v] === SHAPE_CUBE ? 1 : 0;
          lastOpaque =
            lastCube === 1 && (v === BOUNDARY || (classOpaque[stateTable[v] >>> 24] & 1) === 1)
              ? 1
              : 0;
        }
        if (lastCube === 0) {
          pushShapedVoxel(x | (z << 5) | (y << 10) | (v << 15));
          continue;
        }
        if (lastOpaque === 1) occluderRow |= 1 << x;
        if (v !== BOUNDARY) meshableRow |= 1 << x;
      }
      const column = ((z + 1) << T2_SHIFT) | (y + 1);
      columnOccluder[column] = occluderRow;
      columnMeshable[column] = meshableRow;
      anyMeshable |= meshableRow;
    }
  }
  return anyMeshable;
};

/**
 * Word-scan variant of buildInteriorColumns for 4-byte-aligned padded data:
 * each row spanning x = -1..32 is exactly 17 aligned u32 words, and uniform
 * runs (both cells equal to the previous word) reuse the previous pair bits.
 */
const buildInteriorColumnsWords = (
  padded: Uint16Array,
  stateTable: Uint32Array,
  stateShapes: Uint8Array,
  classOpaque: Uint8Array,
): number => {
  const words = new Uint32Array(padded.buffer, padded.byteOffset, padded.length >> 1);
  let anyMeshable = 0;
  let lastWord = -1;
  let lastOccluderPair = 0;
  let lastMeshablePair = 0;
  let lastPairShaped = 0;
  let lastStateId = -1;
  let lastOpaque = 0;
  let lastCube = 1;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const rowWordBase = ((y + 1) * (PAD * PAD) + (z + 1) * PAD) >> 1;
      let occluderRow = 0;
      let meshableRow = 0;
      const headWord = words[rowWordBase];
      const headCell = LITTLE_ENDIAN ? headWord >>> 16 : headWord & 0xffff;
      if (headCell !== AIR) {
        if (headCell !== lastStateId) {
          lastStateId = headCell;
          lastCube = headCell === BOUNDARY || stateShapes[headCell] === SHAPE_CUBE ? 1 : 0;
          lastOpaque =
            lastCube === 1 &&
            (headCell === BOUNDARY || (classOpaque[stateTable[headCell] >>> 24] & 1) === 1)
              ? 1
              : 0;
        }
        if (lastCube === 0) {
          pushShapedVoxel((z << 5) | (y << 10) | (headCell << 15));
        } else {
          if (lastOpaque === 1) occluderRow |= 1;
          if (headCell !== BOUNDARY) meshableRow |= 1;
        }
      }
      for (let wi = 1; wi < 16; wi++) {
        const word = words[rowWordBase + wi];
        if (word === 0) continue;
        const shift = (wi << 1) - 1;
        if (word === lastWord && lastPairShaped === 0) {
          occluderRow |= lastOccluderPair << shift;
          meshableRow |= lastMeshablePair << shift;
          continue;
        }
        const vA = LITTLE_ENDIAN ? word & 0xffff : word >>> 16;
        const vB = LITTLE_ENDIAN ? word >>> 16 : word & 0xffff;
        let occluderPair = 0;
        let meshablePair = 0;
        let pairShaped = 0;
        if (vA !== AIR) {
          if (vA !== lastStateId) {
            lastStateId = vA;
            lastCube = vA === BOUNDARY || stateShapes[vA] === SHAPE_CUBE ? 1 : 0;
            lastOpaque =
              lastCube === 1 && (vA === BOUNDARY || (classOpaque[stateTable[vA] >>> 24] & 1) === 1)
                ? 1
                : 0;
          }
          if (lastCube === 0) {
            pushShapedVoxel(shift | (z << 5) | (y << 10) | (vA << 15));
            pairShaped = 1;
          } else {
            if (lastOpaque === 1) occluderPair |= 1;
            if (vA !== BOUNDARY) meshablePair |= 1;
          }
        }
        if (vB !== AIR) {
          if (vB !== lastStateId) {
            lastStateId = vB;
            lastCube = vB === BOUNDARY || stateShapes[vB] === SHAPE_CUBE ? 1 : 0;
            lastOpaque =
              lastCube === 1 && (vB === BOUNDARY || (classOpaque[stateTable[vB] >>> 24] & 1) === 1)
                ? 1
                : 0;
          }
          if (lastCube === 0) {
            pushShapedVoxel((shift + 1) | (z << 5) | (y << 10) | (vB << 15));
            pairShaped = 1;
          } else {
            if (lastOpaque === 1) occluderPair |= 2;
            if (vB !== BOUNDARY) meshablePair |= 2;
          }
        }
        occluderRow |= occluderPair << shift;
        meshableRow |= meshablePair << shift;
        lastWord = word;
        lastOccluderPair = occluderPair;
        lastMeshablePair = meshablePair;
        lastPairShaped = pairShaped;
      }
      const tailWord = words[rowWordBase + 16];
      const tailCell = LITTLE_ENDIAN ? tailWord & 0xffff : tailWord >>> 16;
      if (tailCell !== AIR) {
        if (tailCell !== lastStateId) {
          lastStateId = tailCell;
          lastCube = tailCell === BOUNDARY || stateShapes[tailCell] === SHAPE_CUBE ? 1 : 0;
          lastOpaque =
            lastCube === 1 &&
            (tailCell === BOUNDARY || (classOpaque[stateTable[tailCell] >>> 24] & 1) === 1)
              ? 1
              : 0;
        }
        if (lastCube === 0) {
          pushShapedVoxel(31 | (z << 5) | (y << 10) | (tailCell << 15));
        } else {
          if (lastOpaque === 1) occluderRow |= 1 << 31;
          if (tailCell !== BOUNDARY) meshableRow |= 1 << 31;
        }
      }
      const column = ((z + 1) << T2_SHIFT) | (y + 1);
      columnOccluder[column] = occluderRow;
      columnMeshable[column] = meshableRow;
      anyMeshable |= meshableRow;
    }
  }
  return anyMeshable;
};

/** Derives the y- and z-normal interior columns from the x family via bit transposes. */
const deriveTransposedColumns = (family: Int32Array): void => {
  for (let z = 0; z < CHUNK_SIZE; z++) {
    const sourceBase = ((z + 1) << T2_SHIFT) + 1;
    let any = 0;
    for (let y = 0; y < CHUNK_SIZE; y++) any |= transposeScratch[y] = family[sourceBase + y];
    const destBase = (1 << AXIS_SHIFT) | sourceBase;
    if (any === 0) {
      family.fill(0, destBase, destBase + CHUNK_SIZE);
      continue;
    }
    transpose32(transposeScratch);
    for (let x = 0; x < CHUNK_SIZE; x++) family[destBase + x] = transposeScratch[x];
  }
  for (let y = 0; y < CHUNK_SIZE; y++) {
    let any = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      any |= transposeScratch[z] = family[((z + 1) << T2_SHIFT) | (y + 1)];
    }
    const destBase = (2 << AXIS_SHIFT) | ((y + 1) << T2_SHIFT) | 1;
    if (any === 0) {
      family.fill(0, destBase, destBase + CHUNK_SIZE);
      continue;
    }
    transpose32(transposeScratch);
    for (let x = 0; x < CHUNK_SIZE; x++) family[destBase + x] = transposeScratch[x];
  }
};

/** Routes one non-air padded-shell cell into tangent-shell columns / normal-shell tables. */
const classifyShellCell = (
  v: number,
  px: number,
  py: number,
  pz: number,
  stateTable: Uint32Array,
  stateShapes: Uint8Array,
  classOpaque: Uint8Array,
): void => {
  if (v !== BOUNDARY && stateShapes[v] !== SHAPE_CUBE) return;
  const opaque = v === BOUNDARY ? 1 : classOpaque[stateTable[v] >>> 24] & 1;
  const columnX = ((pz + 1) << T2_SHIFT) | (py + 1);
  if (px >= 0 && px < CHUNK_SIZE) {
    if (opaque === 1) columnOccluder[columnX] |= 1 << px;
  } else if (px < 0) {
    shellLowOccluder[columnX] = opaque;
    shellLowNonAir[columnX] = 1;
  } else {
    shellHighOccluder[columnX] = opaque;
    shellHighNonAir[columnX] = 1;
  }
  const columnY = (1 << AXIS_SHIFT) | ((pz + 1) << T2_SHIFT) | (px + 1);
  if (py >= 0 && py < CHUNK_SIZE) {
    if (opaque === 1) columnOccluder[columnY] |= 1 << py;
  } else if (py < 0) {
    shellLowOccluder[columnY] = opaque;
    shellLowNonAir[columnY] = 1;
  } else {
    shellHighOccluder[columnY] = opaque;
    shellHighNonAir[columnY] = 1;
  }
  const columnZ = (2 << AXIS_SHIFT) | ((py + 1) << T2_SHIFT) | (px + 1);
  if (pz >= 0 && pz < CHUNK_SIZE) {
    if (opaque === 1) columnOccluder[columnZ] |= 1 << pz;
  } else if (pz < 0) {
    shellLowOccluder[columnZ] = opaque;
    shellLowNonAir[columnZ] = 1;
  } else {
    shellHighOccluder[columnZ] = opaque;
    shellHighNonAir[columnZ] = 1;
  }
};

/** Classifies every padded-shell cell (any coordinate at -1 or 32). */
const buildShellTables = (
  padded: Uint16Array,
  stateTable: Uint32Array,
  stateShapes: Uint8Array,
  classOpaque: Uint8Array,
): void => {
  for (const py of [-1, CHUNK_SIZE]) {
    let cellIndex = (py + 1) * PAD * PAD;
    for (let pz = -1; pz <= CHUNK_SIZE; pz++) {
      for (let px = -1; px <= CHUNK_SIZE; px++, cellIndex++) {
        const v = padded[cellIndex];
        if (v !== AIR) classifyShellCell(v, px, py, pz, stateTable, stateShapes, classOpaque);
      }
    }
  }
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (const pz of [-1, CHUNK_SIZE]) {
      let cellIndex = (y + 1) * PAD * PAD + (pz + 1) * PAD;
      for (let px = -1; px <= CHUNK_SIZE; px++, cellIndex++) {
        const v = padded[cellIndex];
        if (v !== AIR) classifyShellCell(v, px, y, pz, stateTable, stateShapes, classOpaque);
      }
    }
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const rowIndex = (y + 1) * PAD * PAD + (z + 1) * PAD;
      const low = padded[rowIndex];
      if (low !== AIR) classifyShellCell(low, -1, y, z, stateTable, stateShapes, classOpaque);
      const high = padded[rowIndex + PAD - 1];
      if (high !== AIR)
        classifyShellCell(high, CHUNK_SIZE, y, z, stateTable, stateShapes, classOpaque);
    }
  }
};

/** Fills the occupancy tables from padded data; returns 1 when any cell is meshable. */
const buildOccupancy = (
  padded: Uint16Array,
  stateTable: Uint32Array,
  stateShapes: Uint8Array,
  classOpaque: Uint8Array,
): number => {
  columnOccluder.fill(0);
  shellLowOccluder.fill(0);
  shellHighOccluder.fill(0);
  shellLowNonAir.fill(0);
  shellHighNonAir.fill(0);
  const anyMeshable =
    (padded.byteOffset & 3) === 0
      ? buildInteriorColumnsWords(padded, stateTable, stateShapes, classOpaque)
      : buildInteriorColumns(padded, stateTable, stateShapes, classOpaque);
  if (anyMeshable === 0) return 0;
  deriveTransposedColumns(columnMeshable);
  deriveTransposedColumns(columnOccluder);
  buildShellTables(padded, stateTable, stateShapes, classOpaque);
  return 1;
};

/** Fills faceRowMask / faceKeys with the visible faces (and their AO) for direction d. */
const computeDirectionFaces = (padded: Uint16Array, d: number): void => {
  const normalAxis = NORMAL_AXIS[d];
  const uAxis = TANGENT_U_AXIS[d];
  const wAxis = TANGENT_W_AXIS[d];
  const strideN = AXIS_STRIDE[normalAxis];
  const strideU = AXIS_STRIDE[uAxis];
  const strideW = AXIS_STRIDE[wAxis];
  const positive = (d & 1) === 0;
  const swapTangents = uAxis > wAxis;
  const columnStrideU = swapTangents ? 1 << T2_SHIFT : 1;
  const columnStrideW = swapTangents ? 1 : 1 << T2_SHIFT;
  const axisBase = normalAxis << AXIS_SHIFT;

  faceRowMask.fill(0);
  for (let t2 = 0; t2 < CHUNK_SIZE; t2++) {
    for (let t1 = 0; t1 < CHUNK_SIZE; t1++) {
      const column = axisBase | ((t2 + 1) << T2_SHIFT) | (t1 + 1);
      const meshable = columnMeshable[column];
      if (meshable === 0) continue;
      const occluder = columnOccluder[column];
      const nonAir = meshable | occluder;
      const opaqueMeshable = meshable & occluder;
      const transparentMeshable = meshable & ~occluder;
      let visible: number;
      if (positive) {
        const occluderAhead = (occluder >>> 1) | (shellHighOccluder[column] << 31);
        const nonAirAhead = (nonAir >>> 1) | (shellHighNonAir[column] << 31);
        visible = (opaqueMeshable & ~occluderAhead) | (transparentMeshable & ~nonAirAhead);
      } else {
        const occluderBehind = (occluder << 1) | shellLowOccluder[column];
        const nonAirBehind = (nonAir << 1) | shellLowNonAir[column];
        visible = (opaqueMeshable & ~occluderBehind) | (transparentMeshable & ~nonAirBehind);
      }
      if (visible === 0) continue;

      let occluderUm = 0;
      let occluderUp = 0;
      let occluderWm = 0;
      let occluderWp = 0;
      let occluderUmWm = 0;
      let occluderUpWm = 0;
      let occluderUpWp = 0;
      let occluderUmWp = 0;
      let aoNeeded = 0;
      if ((visible & opaqueMeshable) !== 0) {
        const columnUm = column - columnStrideU;
        const columnUp = column + columnStrideU;
        const columnWm = column - columnStrideW;
        const columnWp = column + columnStrideW;
        if (positive) {
          occluderUm = (columnOccluder[columnUm] >>> 1) | (shellHighOccluder[columnUm] << 31);
          occluderUp = (columnOccluder[columnUp] >>> 1) | (shellHighOccluder[columnUp] << 31);
          occluderWm = (columnOccluder[columnWm] >>> 1) | (shellHighOccluder[columnWm] << 31);
          occluderWp = (columnOccluder[columnWp] >>> 1) | (shellHighOccluder[columnWp] << 31);
          occluderUmWm =
            (columnOccluder[columnUm - columnStrideW] >>> 1) |
            (shellHighOccluder[columnUm - columnStrideW] << 31);
          occluderUpWm =
            (columnOccluder[columnUp - columnStrideW] >>> 1) |
            (shellHighOccluder[columnUp - columnStrideW] << 31);
          occluderUpWp =
            (columnOccluder[columnUp + columnStrideW] >>> 1) |
            (shellHighOccluder[columnUp + columnStrideW] << 31);
          occluderUmWp =
            (columnOccluder[columnUm + columnStrideW] >>> 1) |
            (shellHighOccluder[columnUm + columnStrideW] << 31);
        } else {
          occluderUm = (columnOccluder[columnUm] << 1) | shellLowOccluder[columnUm];
          occluderUp = (columnOccluder[columnUp] << 1) | shellLowOccluder[columnUp];
          occluderWm = (columnOccluder[columnWm] << 1) | shellLowOccluder[columnWm];
          occluderWp = (columnOccluder[columnWp] << 1) | shellLowOccluder[columnWp];
          occluderUmWm =
            (columnOccluder[columnUm - columnStrideW] << 1) |
            shellLowOccluder[columnUm - columnStrideW];
          occluderUpWm =
            (columnOccluder[columnUp - columnStrideW] << 1) |
            shellLowOccluder[columnUp - columnStrideW];
          occluderUpWp =
            (columnOccluder[columnUp + columnStrideW] << 1) |
            shellLowOccluder[columnUp + columnStrideW];
          occluderUmWp =
            (columnOccluder[columnUm + columnStrideW] << 1) |
            shellLowOccluder[columnUm + columnStrideW];
        }
        aoNeeded =
          visible &
          opaqueMeshable &
          (occluderUm |
            occluderUp |
            occluderWm |
            occluderWp |
            occluderUmWm |
            occluderUpWm |
            occluderUpWp |
            occluderUmWp);
      }

      const u = swapTangents ? t2 : t1;
      const w = swapTangents ? t1 : t2;
      const columnOrigin = ORIGIN + u * strideU + w * strideW;
      const cellBase = (w << 5) | u;
      const faceBit = 1 << u;
      while (visible !== 0) {
        const layer = 31 - Math.clz32(visible & -visible);
        visible &= visible - 1;
        const stateId = padded[columnOrigin + layer * strideN];
        let aoPack = 0xff;
        if (((aoNeeded >> layer) & 1) === 1) {
          const um = (occluderUm >> layer) & 1;
          const up = (occluderUp >> layer) & 1;
          const wm = (occluderWm >> layer) & 1;
          const wp = (occluderWp >> layer) & 1;
          const ao00 = um & wm ? 0 : 3 - um - wm - ((occluderUmWm >> layer) & 1);
          const ao10 = up & wm ? 0 : 3 - up - wm - ((occluderUpWm >> layer) & 1);
          const ao11 = up & wp ? 0 : 3 - up - wp - ((occluderUpWp >> layer) & 1);
          const ao01 = um & wp ? 0 : 3 - um - wp - ((occluderUmWp >> layer) & 1);
          aoPack = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
        }
        faceKeys[(layer << 10) | cellBase] = (aoPack << 16) | stateId;
        faceRowMask[(layer << 5) | w] |= faceBit;
      }
    }
  }
};

/** Appends one merged quad to a builder; corners ordered c00,c10,c11,c01 in (u,w). */
const emitQuad = (
  bld: Builder,
  d: number,
  plane: number,
  u0: number,
  w0: number,
  u1: number,
  w1: number,
  stateKey: number,
  aoPack: number,
  glossByte: number,
  emissiveByte: number,
): void => {
  if (bld.vertexCount + 4 > bld.capacity) growBuilder(bld);
  const base = bld.vertexCount;
  const normalAxis = NORMAL_AXIS[d];
  const uAxis = TANGENT_U_AXIS[d];
  const wAxis = TANGENT_W_AXIS[d];

  const pos = bld.position;
  let pi = base * 3;
  cornerPos[normalAxis] = plane;
  cornerPos[uAxis] = u0;
  cornerPos[wAxis] = w0;
  pos[pi++] = cornerPos[0];
  pos[pi++] = cornerPos[1];
  pos[pi++] = cornerPos[2];
  cornerPos[uAxis] = u1;
  pos[pi++] = cornerPos[0];
  pos[pi++] = cornerPos[1];
  pos[pi++] = cornerPos[2];
  cornerPos[wAxis] = w1;
  pos[pi++] = cornerPos[0];
  pos[pi++] = cornerPos[1];
  pos[pi++] = cornerPos[2];
  cornerPos[uAxis] = u0;
  pos[pi++] = cornerPos[0];
  pos[pi++] = cornerPos[1];
  pos[pi] = cornerPos[2];

  const normalWord = NORMAL_WORDS[d];
  const normalWords = bld.normalWords;
  normalWords[base] = normalWord;
  normalWords[base + 1] = normalWord;
  normalWords[base + 2] = normalWord;
  normalWords[base + 3] = normalWord;

  const colorWord = packBytes4(
    (stateKey >>> 16) & 0xff,
    (stateKey >>> 8) & 0xff,
    stateKey & 0xff,
    255,
  );
  const colorWords = bld.colorWords;
  colorWords[base] = colorWord;
  colorWords[base + 1] = colorWord;
  colorWords[base + 2] = colorWord;
  colorWords[base + 3] = colorWord;

  const ao0 = aoPack & 3;
  const ao1 = (aoPack >>> 2) & 3;
  const ao2 = (aoPack >>> 4) & 3;
  const ao3 = (aoPack >>> 6) & 3;
  const extraBase = packBytes4(0, glossByte, emissiveByte, 0);
  const extraWords = bld.extraWords;
  extraWords[base] = extraBase | ((ao0 * 85) << BYTE0_SHIFT);
  extraWords[base + 1] = extraBase | ((ao1 * 85) << BYTE0_SHIFT);
  extraWords[base + 2] = extraBase | ((ao2 * 85) << BYTE0_SHIFT);
  extraWords[base + 3] = extraBase | ((ao3 * 85) << BYTE0_SHIFT);

  const ind = bld.index;
  const ii = bld.indexCount;
  if (ao0 + ao2 > ao1 + ao3) {
    ind[ii] = base + 1;
    ind[ii + 1] = base + 2;
    ind[ii + 2] = base + 3;
    ind[ii + 3] = base + 1;
    ind[ii + 4] = base + 3;
    ind[ii + 5] = base;
  } else {
    ind[ii] = base;
    ind[ii + 1] = base + 1;
    ind[ii + 2] = base + 2;
    ind[ii + 3] = base;
    ind[ii + 4] = base + 2;
    ind[ii + 5] = base + 3;
  }
  bld.vertexCount += 4;
  bld.indexCount += 6;
};

/** Greedy-merges the pending faces of direction d into quads; returns true when any emitted. */
const mergeDirectionFaces = (
  d: number,
  stateTable: Uint32Array,
  classBucket: Uint8Array,
  classGloss: Uint8Array,
  classEmissive: Uint8Array,
  builders: (Builder | null)[],
): boolean => {
  const positive = (d & 1) === 0;
  let emitted = false;
  for (let layer = 0; layer < CHUNK_SIZE; layer++) {
    const rowBase = layer << 5;
    const keyBase = layer << 10;
    const plane = positive ? layer + 1 : layer;
    for (let w0 = 0; w0 < CHUNK_SIZE; w0++) {
      let row = faceRowMask[rowBase | w0];
      while (row !== 0) {
        const u0 = 31 - Math.clz32(row & -row);
        const key = faceKeys[keyBase | (w0 << 5) | u0];
        let runWidth = 1;
        while (
          u0 + runWidth < CHUNK_SIZE &&
          (row & (1 << (u0 + runWidth))) !== 0 &&
          faceKeys[keyBase | (w0 << 5) | (u0 + runWidth)] === key
        ) {
          runWidth++;
        }
        const runMask = runWidth === 32 ? -1 : ((1 << runWidth) - 1) << u0;
        let runHeight = 1;
        expand: while (w0 + runHeight < CHUNK_SIZE) {
          if ((faceRowMask[rowBase | (w0 + runHeight)] & runMask) !== runMask) break;
          const candidateBase = keyBase | ((w0 + runHeight) << 5);
          for (let k = 0; k < runWidth; k++) {
            if (faceKeys[candidateBase | (u0 + k)] !== key) break expand;
          }
          runHeight++;
        }
        for (let h = 0; h < runHeight; h++) {
          faceRowMask[rowBase | (w0 + h)] &= ~runMask;
        }
        row = faceRowMask[rowBase | w0];

        const stateId = key & 0xffff;
        const aoPack = (key >>> 16) & 0xff;
        const stateKey = stateTable[stateId];
        const cls = stateKey >>> 24;
        const bucket = classBucket[cls];
        const bld = acquireBuilder(builders, bucket);
        emitQuad(
          bld,
          d,
          plane,
          u0,
          w0,
          u0 + runWidth,
          w0 + runHeight,
          stateKey,
          aoPack,
          classGloss[cls] === 0 ? 0 : 255,
          classEmissive[cls] === 0 ? 0 : 255,
        );
        emitted = true;
      }
    }
  }
  return emitted;
};

/** Appends one template face of a shaped voxel at chunk-local (x,y,z). */
const emitShapeFace = (
  bld: Builder,
  face: ShapeFace,
  x: number,
  y: number,
  z: number,
  colorWord: number,
  extraWord: number,
): void => {
  const vertexCount = face.vertexCount;
  if (bld.vertexCount + vertexCount > bld.capacity) growBuilder(bld);
  const base = bld.vertexCount;
  const pos = bld.position;
  const corners = face.positions;
  let pi = base * 3;
  for (let k = 0, ci = 0; k < vertexCount; k++) {
    pos[pi++] = x + corners[ci++];
    pos[pi++] = y + corners[ci++];
    pos[pi++] = z + corners[ci++];
  }
  for (let k = 0; k < vertexCount; k++) {
    bld.normalWords[base + k] = face.normalWord;
    bld.colorWords[base + k] = colorWord;
    bld.extraWords[base + k] = extraWord;
  }
  const ind = bld.index;
  let ii = bld.indexCount;
  ind[ii++] = base;
  ind[ii++] = base + 1;
  ind[ii++] = base + 2;
  if (vertexCount === 4) {
    ind[ii++] = base;
    ind[ii++] = base + 2;
    ind[ii++] = base + 3;
  }
  bld.vertexCount += vertexCount;
  bld.indexCount = ii;
};

/** Emits all collected non-cube voxels from their shape templates; returns true when any face drew. */
const emitShapedVoxels = (
  padded: Uint16Array,
  stateTable: Uint32Array,
  stateShapes: Uint8Array,
  classOpaque: Uint8Array,
  classBucket: Uint8Array,
  classGloss: Uint8Array,
  classEmissive: Uint8Array,
  builders: (Builder | null)[],
): boolean => {
  let emitted = false;
  for (let i = 0; i < shapedVoxelCount; i++) {
    const packed = shapedVoxels[i];
    const x = packed & 31;
    const z = (packed >>> 5) & 31;
    const y = (packed >>> 10) & 31;
    const stateId = packed >>> 15;
    const stateKey = stateTable[stateId];
    const cls = stateKey >>> 24;
    const bld = acquireBuilder(builders, classBucket[cls]);
    const colorWord = packBytes4(
      (stateKey >>> 16) & 0xff,
      (stateKey >>> 8) & 0xff,
      stateKey & 0xff,
      255,
    );
    const extraWord = packBytes4(
      255,
      classGloss[cls] === 0 ? 0 : 255,
      classEmissive[cls] === 0 ? 0 : 255,
      0,
    );
    const faces = SHAPE_FACES[stateShapes[stateId]];
    const cellIndex = ORIGIN + x + y * (PAD * PAD) + z * PAD;
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      if (face.cullFace >= 0) {
        const neighbor = padded[cellIndex + FACE_OFFSET[face.cullFace]];
        if (
          neighbor === BOUNDARY ||
          (neighbor !== AIR &&
            stateShapes[neighbor] === SHAPE_CUBE &&
            classOpaque[stateTable[neighbor] >>> 24] === 1)
        ) {
          continue;
        }
      }
      emitShapeFace(bld, face, x, y, z, colorWord, extraWord);
      emitted = true;
    }
  }
  return emitted;
};

/** Greedy-meshes one padded chunk into per-bucket geometry (null = empty bucket, [] = nothing). */
export const meshChunk = (
  padded: Uint16Array,
  stateTable: Uint32Array,
  stateShapes: Uint8Array,
  classOpaque: Uint8Array,
  classBucket: Uint8Array,
  classGloss: Uint8Array,
  classEmissive: Uint8Array,
): ChunkGeometry => {
  if (isAllAir(padded)) return [];
  shapedVoxelCount = 0;
  const anyMeshable = buildOccupancy(padded, stateTable, stateShapes, classOpaque);
  if (anyMeshable === 0 && shapedVoxelCount === 0) return [];

  let maxBucket = 0;
  for (let i = 0; i < classBucket.length; i++) {
    if (classBucket[i] > maxBucket) maxBucket = classBucket[i];
  }
  const builders: (Builder | null)[] = new Array(maxBucket + 1).fill(null);
  let emitted = false;

  if (anyMeshable === 1) {
    for (let d = 0; d < 6; d++) {
      computeDirectionFaces(padded, d);
      emitted =
        mergeDirectionFaces(d, stateTable, classBucket, classGloss, classEmissive, builders) ||
        emitted;
    }
  }
  emitted =
    emitShapedVoxels(
      padded,
      stateTable,
      stateShapes,
      classOpaque,
      classBucket,
      classGloss,
      classEmissive,
      builders,
    ) || emitted;

  if (!emitted) return [];
  const out: ChunkGeometry = new Array(maxBucket + 1).fill(null);
  for (let i = 0; i <= maxBucket; i++) {
    const b = builders[i];
    if (b !== null) out[i] = finishBuilder(b);
  }
  return out;
};
