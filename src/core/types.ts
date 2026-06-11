/**
 * Shared contracts for every module. Pure data and tiny helpers only.
 * No three.js imports allowed here or anywhere under core/, mesh/, interact/, io/ (except io/gltf.ts).
 *
 * Conventions
 * - Voxel coords are integers (x, y, z), y-up. World spans [0,WORLD_SX) x [0,WORLD_SY) x [0,WORLD_SZ).
 * - A voxel holds a `stateId` indexing the world state table; stateId 0 is always air.
 * - A state key packs material class and color: (cls << 24) | 0xRRGGBB.
 * - Face ids: 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z.
 */

// ── grid ──────────────────────────────────────────────────────────────────────

export const CHUNK_BITS = 5;
export const CHUNK_SIZE = 1 << CHUNK_BITS; // 32
export const CHUNK_VOLUME = CHUNK_SIZE ** 3; // 32768

/** Padded chunk (one-voxel shell of neighbor data) used by the mesher. */
export const PAD = CHUNK_SIZE + 2; // 34
export const PAD_VOLUME = PAD ** 3;

/**
 * World dimensions are mutable module state, fixed once at boot (applyWorldDims) before
 * any world/scheduler/renderer construction. Chunk size stays 32 — only the chunk-grid
 * extent varies. All helpers read these live bindings at call time.
 */
export let WORLD_CX = 8;
export let WORLD_CY = 4;
export let WORLD_CZ = 8;
export let CHUNK_COUNT = WORLD_CX * WORLD_CY * WORLD_CZ;

export let WORLD_SX = WORLD_CX << CHUNK_BITS; // 256
export let WORLD_SY = WORLD_CY << CHUNK_BITS; // 128
export let WORLD_SZ = WORLD_CZ << CHUNK_BITS; // 256

export interface WorldPreset {
  id: string;
  label: string;
  cx: number;
  cy: number;
  cz: number;
}

export const WORLD_PRESETS: readonly WorldPreset[] = [
  { id: "small", label: "Small", cx: 3, cy: 2, cz: 3 }, // 96 x 64 x 96
  { id: "medium", label: "Medium", cx: 5, cy: 3, cz: 5 }, // 160 x 96 x 160
  { id: "large", label: "Large", cx: 8, cy: 4, cz: 8 }, // 256 x 128 x 256
  { id: "huge", label: "Huge", cx: 12, cy: 4, cz: 12 }, // 384 x 128 x 384
];

/** Fix the world chunk-grid dimensions. MUST run before any world-sized construction. */
export const applyWorldDims = (cx: number, cy: number, cz: number): void => {
  if (cx < 1 || cy < 1 || cz < 1 || cx > 64 || cy > 16 || cz > 64) {
    throw new Error(`invalid world dims ${cx}x${cy}x${cz}`);
  }
  WORLD_CX = cx;
  WORLD_CY = cy;
  WORLD_CZ = cz;
  CHUNK_COUNT = cx * cy * cz;
  WORLD_SX = cx << CHUNK_BITS;
  WORLD_SY = cy << CHUNK_BITS;
  WORLD_SZ = cz << CHUNK_BITS;
};

/** Linear index of a voxel inside a chunk; x/z fastest so horizontal slices stay contiguous. */
export const vIndex = (x: number, y: number, z: number): number =>
  x | (z << CHUNK_BITS) | (y << (CHUNK_BITS << 1));

/** Linear index into padded chunk data; accepts chunk-local coords in [-1, CHUNK_SIZE]. */
export const pIndex = (x: number, y: number, z: number): number =>
  x + 1 + (z + 1) * PAD + (y + 1) * PAD * PAD;

/** Linear chunk index from chunk coords. */
export const cIndex = (cx: number, cy: number, cz: number): number =>
  cx + cz * WORLD_CX + cy * WORLD_CX * WORLD_CZ;

export const inWorld = (x: number, y: number, z: number): boolean =>
  x >= 0 && y >= 0 && z >= 0 && x < WORLD_SX && y < WORLD_SY && z < WORLD_SZ;

// ── block states ──────────────────────────────────────────────────────────────

export const AIR = 0;
/**
 * Synthetic padded-data value meaning "outside the world, below the baseplate".
 * Treated as an opaque occluder (kills bottom faces, contributes contact AO); never meshed itself.
 */
export const BOUNDARY = 0xffff;

export const MaterialClass = { Matte: 0, Gloss: 1, Emissive: 2, Glass: 3 } as const;
export type MaterialClassId = number;

export const packState = (cls: number, rgb: number): number =>
  ((cls << 24) | (rgb & 0xffffff)) >>> 0;
export const stateClass = (key: number): number => key >>> 24;
export const stateRgb = (key: number): number => key & 0xffffff;

// ── block shapes ──────────────────────────────────────────────────────────────

/**
 * Per-state geometry shape, stored in a table parallel to the state keys.
 * Semantics for meshing:
 * - Only SHAPE_CUBE voxels enter the greedy path and occlude neighbors / cast AO.
 * - Non-cube voxels are emitted per-voxel from templates; their cell-boundary faces
 *   are culled only against opaque full cubes (or BOUNDARY), interior faces always draw.
 */
export const SHAPE_CUBE = 0;
export const SHAPE_SLAB_BOTTOM = 1;
export const SHAPE_SLAB_TOP = 2;
export const SHAPE_RAMP_PX = 3;
export const SHAPE_RAMP_NX = 4;
export const SHAPE_RAMP_PZ = 5;
export const SHAPE_RAMP_NZ = 6;
export const SHAPE_COUNT = 7;

/** Map-safe uniqueness key for (cls, rgb, shape) — exact below 2^53. */
export const stateUniqueKey = (key32: number, shape: number): number => key32 + shape * 0x100000000;

export const BUCKET_OPAQUE = 0;
export const BUCKET_GLASS = 1;

/** Per-material-class render config, indexed by class id. Custom classes append at id >= 4. */
export interface ClassTable {
  /** 1 = occludes neighbors (face culling + AO contribution). */
  opaque: Uint8Array;
  /** Render bucket id (one mesh + material per bucket per chunk). */
  bucket: Uint8Array;
  /** 1 = glossy vertices (low roughness). */
  gloss: Uint8Array;
  /** 1 = emissive vertices (feeds bloom). */
  emissive: Uint8Array;
}

export const builtinClassTable = (): ClassTable => ({
  opaque: Uint8Array.of(1, 1, 1, 0),
  bucket: Uint8Array.of(BUCKET_OPAQUE, BUCKET_OPAQUE, BUCKET_OPAQUE, BUCKET_GLASS),
  gloss: Uint8Array.of(0, 1, 0, 0),
  emissive: Uint8Array.of(0, 0, 1, 0),
});

/** Append one custom class; returns a new table (tables are treated as immutable). */
export const appendClass = (
  t: ClassTable,
  opts: { opaque: boolean; bucket: number; gloss?: boolean; emissive?: boolean },
): ClassTable => {
  const push = (a: Uint8Array, v: number) => {
    const out = new Uint8Array(a.length + 1);
    out.set(a);
    out[a.length] = v;
    return out;
  };
  return {
    opaque: push(t.opaque, opts.opaque ? 1 : 0),
    bucket: push(t.bucket, opts.bucket),
    gloss: push(t.gloss, opts.gloss ? 1 : 0),
    emissive: push(t.emissive, opts.emissive ? 1 : 0),
  };
};

// ── faces ─────────────────────────────────────────────────────────────────────

/** Face id → outward normal, flat-packed [x,y,z] per face. */
export const FACE_NORMAL = Int8Array.of(1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1);

// ── mesh output ───────────────────────────────────────────────────────────────

/**
 * One render bucket worth of geometry for a chunk, in chunk-local coordinates [0..32].
 * All 8-bit attributes are 4-component: WebGPU vertex formats pad 8-bit attrs to 4 bytes
 * (snorm8x4/unorm8x4) while three keeps arrayStride = itemSize, so 3-component 8-bit
 * attributes fail pipeline validation. Attribute layout (per vertex):
 * - position: f32 x3
 * - normal:   i8 x4, +-127 on exactly one axis, w = 0, uploaded normalized
 * - color:    u8 x4 sRGB rgb + 255 alpha, uploaded normalized
 * - extra:    u8 x4 [ao, gloss, emissive, 0]; ao in {0,85,170,255}; uploaded normalized
 * - index:    u32, 6 per quad, CCW seen from outside
 */
export interface BucketGeometry {
  position: Float32Array;
  normal: Int8Array;
  color: Uint8Array;
  extra: Uint8Array;
  index: Uint32Array;
  vertexCount: number;
}

/** Sparse per-bucket geometry; null/missing = bucket empty for this chunk. */
export type ChunkGeometry = (BucketGeometry | null)[];

// ── mesher worker protocol ────────────────────────────────────────────────────

export interface MeshJobMsg {
  jobId: number;
  ci: number;
  /** Chunk edit version this job was built from; stale results are dropped. */
  version: number;
  /** PAD_VOLUME resolved stateIds (BOUNDARY sentinel below y=0, AIR outside elsewhere). */
  padded: Uint16Array;
  /** stateId → packed state key (prefix slice of the world table). */
  stateTable: Uint32Array;
  /** stateId → shape id, parallel to stateTable. */
  stateShapes: Uint8Array;
  classOpaque: Uint8Array;
  classBucket: Uint8Array;
  classGloss: Uint8Array;
  classEmissive: Uint8Array;
}

export interface MeshDoneMsg {
  jobId: number;
  ci: number;
  version: number;
  buckets: ChunkGeometry;
  /** Worker-side mesh time in ms. */
  ms: number;
}

// ── snapshots (persistence / interchange) ─────────────────────────────────────

/** Resolved, palette-free view of the world used by codecs. All-air chunks are omitted. */
export interface WorldSnapshot {
  sx: number;
  sy: number;
  sz: number;
  /** stateId → packed key; index 0 is air and must be 0. */
  stateTable: Uint32Array;
  /** stateId → shape id; parallel to stateTable. */
  stateShapes: Uint8Array;
  chunks: { ci: number; states: Uint16Array }[];
}

// ── raycasting ────────────────────────────────────────────────────────────────

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** Face of the hit voxel the ray entered through (0..5). */
  face: number;
  /** True when this hit is the baseplate plane, not a voxel (y === -1, face === 2). */
  ground: boolean;
}
