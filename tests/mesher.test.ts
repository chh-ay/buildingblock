import { describe, expect, test } from "bun:test";
import type { BucketGeometry, ChunkGeometry } from "../src/core/types";
import {
  AIR,
  BOUNDARY,
  builtinClassTable,
  CHUNK_SIZE,
  FACE_NORMAL,
  PAD_VOLUME,
  packState,
  pIndex,
  SHAPE_CUBE,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
  stateClass,
  stateRgb,
} from "../src/core/types";
import { meshChunk } from "../src/mesh/mesher";

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const classes = builtinClassTable();
const matteRed = packState(0, 0xff0000);
const matteBlue = packState(0, 0x0000ff);
const glossWhite = packState(1, 0xffffff);
const emissiveYellow = packState(2, 0xffff00);
const glassCyan = packState(3, 0x00ffff);
const glassMagenta = packState(3, 0xff00ff);
const table = Uint32Array.of(
  0,
  matteRed,
  matteBlue,
  glossWhite,
  emissiveYellow,
  glassCyan,
  glassMagenta,
);
const cubeShapes = new Uint8Array(table.length);

/** Shaped fixtures: ids 1 cube, 2 slabBottom, 3 slabTop, 4..7 ramps PX/NX/PZ/NZ, 8 glass slabBottom. */
const shapedTable = Uint32Array.of(
  0,
  matteRed,
  matteRed,
  matteRed,
  matteRed,
  matteRed,
  matteRed,
  matteRed,
  glassCyan,
);
const shapedShapes = Uint8Array.of(
  0,
  SHAPE_CUBE,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_PZ,
  SHAPE_RAMP_NZ,
  SHAPE_SLAB_BOTTOM,
);

const pad = (): Uint16Array => new Uint16Array(PAD_VOLUME);

const setP = (p: Uint16Array, x: number, y: number, z: number, v: number): void => {
  p[pIndex(x, y, z)] = v;
};

const mesh = (p: Uint16Array): ChunkGeometry =>
  meshChunk(p, table, cubeShapes, classes.opaque, classes.bucket, classes.gloss, classes.emissive);

const meshShaped = (p: Uint16Array): ChunkGeometry =>
  meshChunk(
    p,
    shapedTable,
    shapedShapes,
    classes.opaque,
    classes.bucket,
    classes.gloss,
    classes.emissive,
  );

/** Brute-force occlusion at a padded-local coordinate. */
const occludesRef = (p: Uint16Array, x: number, y: number, z: number): boolean => {
  const v = p[pIndex(x, y, z)];
  if (v === BOUNDARY) return true;
  if (v === AIR) return false;
  return classes.opaque[stateClass(table[v])] === 1;
};

/** Brute-force visible face counts per direction and per direction×bucket. */
const refCounts = (p: Uint16Array): { perDir: number[]; perDirBucket: Map<number, number> } => {
  const perDir = [0, 0, 0, 0, 0, 0];
  const perDirBucket = new Map<number, number>();
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const v = p[pIndex(x, y, z)];
        if (v === AIR || v === BOUNDARY) continue;
        const cls = stateClass(table[v]);
        const opaque = classes.opaque[cls] === 1;
        const bucket = classes.bucket[cls];
        for (let d = 0; d < 6; d++) {
          const ax = x + FACE_NORMAL[d * 3];
          const ay = y + FACE_NORMAL[d * 3 + 1];
          const az = z + FACE_NORMAL[d * 3 + 2];
          const b = p[pIndex(ax, ay, az)];
          const visible = b === AIR || (opaque && !occludesRef(p, ax, ay, az));
          if (!visible) continue;
          perDir[d]++;
          const key = d * 16 + bucket;
          perDirBucket.set(key, (perDirBucket.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return { perDir, perDirBucket };
};

interface Quad {
  d: number;
  pos: number[][];
  extra: number[][];
  color: number[][];
  area: number;
}

const dirOfNormal = (nx: number, ny: number, nz: number): number => {
  for (let d = 0; d < 6; d++) {
    if (
      nx === FACE_NORMAL[d * 3] * 127 &&
      ny === FACE_NORMAL[d * 3 + 1] * 127 &&
      nz === FACE_NORMAL[d * 3 + 2] * 127
    ) {
      return d;
    }
  }
  throw new Error(`bad normal ${nx},${ny},${nz}`);
};

const quadsOf = (g: BucketGeometry | null): Quad[] => {
  if (g === null) return [];
  const out: Quad[] = [];
  for (let q = 0; q < g.vertexCount / 4; q++) {
    const base = q * 4;
    const d = dirOfNormal(g.normal[base * 4], g.normal[base * 4 + 1], g.normal[base * 4 + 2]);
    const n = d >> 1;
    const t1 = n === 0 ? 1 : 0;
    const t2 = n === 2 ? 1 : 2;
    const pos: number[][] = [];
    const extra: number[][] = [];
    const color: number[][] = [];
    for (let k = 0; k < 4; k++) {
      const vi = base + k;
      pos.push([g.position[vi * 3], g.position[vi * 3 + 1], g.position[vi * 3 + 2]]);
      extra.push([g.extra[vi * 4], g.extra[vi * 4 + 1], g.extra[vi * 4 + 2], g.extra[vi * 4 + 3]]);
      color.push([g.color[vi * 4], g.color[vi * 4 + 1], g.color[vi * 4 + 2]]);
    }
    const v1 = pos.map((c) => c[t1]);
    const v2 = pos.map((c) => c[t2]);
    const area = (Math.max(...v1) - Math.min(...v1)) * (Math.max(...v2) - Math.min(...v2));
    out.push({ d, pos, extra, color, area });
  }
  return out;
};

const allQuads = (geo: ChunkGeometry): Quad[] => geo.flatMap((g) => quadsOf(g));

const areaByDir = (quads: Quad[]): number[] => {
  const out = [0, 0, 0, 0, 0, 0];
  for (const q of quads) out[q.d] += q.area;
  return out;
};

/** Asserts every triangle in a bucket winds CCW viewed from outside. */
const checkWinding = (g: BucketGeometry): void => {
  for (let t = 0; t < g.index.length; t += 3) {
    const i0 = g.index[t];
    const i1 = g.index[t + 1];
    const i2 = g.index[t + 2];
    const p = (i: number, c: number) => g.position[i * 3 + c];
    const e1 = [p(i1, 0) - p(i0, 0), p(i1, 1) - p(i0, 1), p(i1, 2) - p(i0, 2)];
    const e2 = [p(i2, 0) - p(i0, 0), p(i2, 1) - p(i0, 1), p(i2, 2) - p(i0, 2)];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const len = Math.hypot(cx, cy, cz);
    const nx = g.normal[i0 * 4] / 127;
    const ny = g.normal[i0 * 4 + 1] / 127;
    const nz = g.normal[i0 * 4 + 2] / 127;
    const dot = (cx * nx + cy * ny + cz * nz) / len;
    expect(dot).toBeGreaterThan(0.99);
  }
};

interface FaceView {
  verts: number[][];
  normal: number[];
  extra: number[][];
  area: number;
}

/**
 * Index-driven face extractor: a face is the run of triangles over one block
 * of 3 (triangle) or 4 (quad) sequentially emitted vertices. Area is true
 * geometric area summed over the face's triangles.
 */
const facesOf = (g: BucketGeometry | null): FaceView[] => {
  if (g === null) return [];
  const out: FaceView[] = [];
  const triCount = g.index.length / 3;
  let ti = 0;
  let vi = 0;
  while (ti < triCount) {
    const nextMin =
      ti + 1 < triCount
        ? Math.min(g.index[(ti + 1) * 3], g.index[(ti + 1) * 3 + 1], g.index[(ti + 1) * 3 + 2])
        : Number.POSITIVE_INFINITY;
    const isQuad = nextMin < vi + 3;
    const vertexCount = isQuad ? 4 : 3;
    const verts: number[][] = [];
    const extra: number[][] = [];
    for (let k = 0; k < vertexCount; k++) {
      const v = vi + k;
      verts.push([g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2]]);
      extra.push([g.extra[v * 4], g.extra[v * 4 + 1], g.extra[v * 4 + 2], g.extra[v * 4 + 3]]);
    }
    const normal = [g.normal[vi * 4] / 127, g.normal[vi * 4 + 1] / 127, g.normal[vi * 4 + 2] / 127];
    let area = 0;
    for (let t = 0; t < (isQuad ? 2 : 1); t++) {
      const base = (ti + t) * 3;
      const a = g.index[base] * 3;
      const b = g.index[base + 1] * 3;
      const c = g.index[base + 2] * 3;
      const e1 = [
        g.position[b] - g.position[a],
        g.position[b + 1] - g.position[a + 1],
        g.position[b + 2] - g.position[a + 2],
      ];
      const e2 = [
        g.position[c] - g.position[a],
        g.position[c + 1] - g.position[a + 1],
        g.position[c + 2] - g.position[a + 2],
      ];
      area +=
        Math.hypot(
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ) / 2;
    }
    out.push({ verts, normal, extra, area });
    ti += isQuad ? 2 : 1;
    vi += vertexCount;
  }
  return out;
};

/** True when every coordinate of every vertex lies inside [lo, hi] per axis. */
const faceWithin = (face: FaceView, lo: number[], hi: number[]): boolean =>
  face.verts.every((v) => v.every((c, axis) => c >= lo[axis] && c <= hi[axis]));

/** Finds a face with the given unit normal whose vertices all sit inside the box. */
const findBoxFace = (
  faces: FaceView[],
  normal: number[],
  lo: number[],
  hi: number[],
): FaceView | undefined =>
  faces.find(
    (f) =>
      Math.abs(f.normal[0] - normal[0]) < 0.01 &&
      Math.abs(f.normal[1] - normal[1]) < 0.01 &&
      Math.abs(f.normal[2] - normal[2]) < 0.01 &&
      faceWithin(f, lo, hi),
  );

describe("meshChunk", () => {
  test("empty padded chunk emits nothing", () => {
    const geo = mesh(pad());
    expect(geo.every((g) => g === null)).toBe(true);
  });

  test("padded full of BOUNDARY emits nothing", () => {
    const p = pad();
    p.fill(BOUNDARY);
    expect(mesh(p)).toEqual([]);
  });

  test("single matte voxel: 24 verts, 36 indices, CCW winding, ao=255", () => {
    const p = pad();
    setP(p, 5, 5, 5, 1);
    const geo = mesh(p);
    const g = geo[0];
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(g.vertexCount).toBe(24);
    expect(g.index.length).toBe(36);
    checkWinding(g);
    for (let i = 0; i < g.vertexCount * 3; i++) {
      expect(g.position[i]).toBeGreaterThanOrEqual(5);
      expect(g.position[i]).toBeLessThanOrEqual(6);
    }
    expect(g.normal.length).toBe(24 * 4);
    expect(g.color.length).toBe(24 * 4);
    for (let i = 0; i < g.vertexCount; i++) {
      expect(g.extra[i * 4]).toBe(255);
      expect(g.normal[i * 4 + 3]).toBe(0);
      expect([g.color[i * 4], g.color[i * 4 + 1], g.color[i * 4 + 2], g.color[i * 4 + 3]]).toEqual([
        255, 0, 0, 255,
      ]);
    }
  });

  test("adjacent red+blue mattes: 10 quads, no shared face, areas match brute force", () => {
    const p = pad();
    setP(p, 5, 5, 5, 1);
    setP(p, 6, 5, 5, 2);
    const geo = mesh(p);
    const quads = allQuads(geo);
    expect(quads.length).toBe(10);
    expect(areaByDir(quads)).toEqual(refCounts(p).perDir);
  });

  test("adjacent same-state mattes merge outer faces to 6 quads", () => {
    const p = pad();
    setP(p, 5, 5, 5, 1);
    setP(p, 6, 5, 5, 1);
    const quads = allQuads(mesh(p));
    expect(quads.length).toBe(6);
    expect(areaByDir(quads)).toEqual(refCounts(p).perDir);
  });

  test("32x32x1 slab fully merges to 6 quads with top area 1024", () => {
    const p = pad();
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) setP(p, x, 0, z, 1);
    }
    const quads = allQuads(mesh(p));
    expect(quads.length).toBe(6);
    expect(areaByDir(quads)[2]).toBe(1024);
  });

  test("slab on BOUNDARY: bottom culled, 5 quads, side bottom-corner ao uniform", () => {
    const p = pad();
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) setP(p, x, 0, z, 1);
    }
    for (let z = -1; z <= CHUNK_SIZE; z++) {
      for (let x = -1; x <= CHUNK_SIZE; x++) setP(p, x, -1, z, BOUNDARY);
    }
    const quads = allQuads(mesh(p));
    expect(quads.length).toBe(5);
    expect(quads.filter((q) => q.d === 3).length).toBe(0);
    const top = quads.filter((q) => q.d === 2);
    expect(top.length).toBe(1);
    expect(top[0].area).toBe(1024);
    const sides = quads.filter((q) => q.d !== 2);
    expect(sides.length).toBe(4);
    for (const q of sides) {
      expect(q.area).toBe(32);
      for (let k = 0; k < 4; k++) {
        // side1 (below) and the diagonal corner are both BOUNDARY: ao = 3-2 = 1.
        expect(q.extra[k][0]).toBe(q.pos[k][1] === 0 ? 85 : 255);
      }
    }
  });

  test("checkerboard 32^3: quad count equals brute-force face count", () => {
    const p = pad();
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (((x + y + z) & 1) === 0) setP(p, x, y, z, 1);
        }
      }
    }
    const ref = refCounts(p);
    const quads = allQuads(mesh(p));
    expect(quads.length).toBe(ref.perDir.reduce((s, c) => s + c, 0));
    expect(areaByDir(quads)).toEqual(ref.perDir);
    for (const q of quads) {
      for (const c of q.pos) {
        for (const v of c) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  test("seeded random fills conserve per-direction per-bucket area and colors", () => {
    for (const density of [0.1, 0.4, 0.7]) {
      const rand = mulberry32(1337 + density * 100);
      const p = pad();
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            if (rand() < density) setP(p, x, y, z, 1 + Math.floor(rand() * 6));
          }
        }
      }
      const ref = refCounts(p);
      const geo = mesh(p);
      for (let bucket = 0; bucket < geo.length; bucket++) {
        const areas = areaByDir(quadsOf(geo[bucket]));
        for (let d = 0; d < 6; d++) {
          expect(areas[d]).toBe(ref.perDirBucket.get(d * 16 + bucket) ?? 0);
        }
      }
      const quads = allQuads(geo);
      for (const q of quads.slice(0, 20)) {
        const n = q.d >> 1;
        const t1 = n === 0 ? 1 : 0;
        const t2 = n === 2 ? 1 : 2;
        const cell = [0, 0, 0];
        cell[n] = (q.d & 1) === 0 ? q.pos[0][n] - 1 : q.pos[0][n];
        cell[t1] = Math.floor(Math.min(...q.pos.map((c) => c[t1])) + 0.5);
        cell[t2] = Math.floor(Math.min(...q.pos.map((c) => c[t2])) + 0.5);
        const rgb = stateRgb(table[p[pIndex(cell[0], cell[1], cell[2])]]);
        expect(q.color[0]).toEqual([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]);
      }
    }
  });

  test("AO: block on 3x3 floor darkens inner top vertices, outer corners stay lit", () => {
    const p = pad();
    for (let z = 2; z <= 4; z++) {
      for (let x = 2; x <= 4; x++) setP(p, x, 0, z, 1);
    }
    const flat = allQuads(mesh(p)).filter((q) => q.d === 2);
    for (const q of flat) for (const e of q.extra) expect(e[0]).toBe(255);

    setP(p, 3, 1, 3, 1);
    const quads = allQuads(mesh(p));
    const floorTop: { pos: number[]; ao: number }[] = [];
    for (const q of quads.filter((c) => c.d === 2)) {
      for (let k = 0; k < 4; k++) {
        if (q.pos[k][1] === 1) floorTop.push({ pos: q.pos[k], ao: q.extra[k][0] });
      }
    }
    expect(floorTop.some((v) => v.ao < 255)).toBe(true);
    for (const [cx, cz] of [
      [2, 2],
      [2, 5],
      [5, 2],
      [5, 5],
    ]) {
      const at = floorTop.filter((v) => v.pos[0] === cx && v.pos[2] === cz);
      expect(at.length).toBeGreaterThan(0);
      for (const v of at) expect(v.ao).toBe(255);
    }
  });

  test("lone glass voxel: 6 quads in bucket 1 with extra [255,0,0,0]", () => {
    const p = pad();
    setP(p, 5, 5, 5, 5);
    const geo = mesh(p);
    expect(geo.length).toBe(2);
    expect(geo[0]).toBeNull();
    const g = geo[1];
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(g.vertexCount).toBe(24);
    for (let i = 0; i < g.vertexCount; i++) {
      expect([g.extra[i * 4], g.extra[i * 4 + 1], g.extra[i * 4 + 2], g.extra[i * 4 + 3]]).toEqual([
        255, 0, 0, 0,
      ]);
    }
  });

  test("same-state glass pair: shared face hidden, outer faces merge to 6 quads area 10", () => {
    const p = pad();
    setP(p, 5, 5, 5, 5);
    setP(p, 6, 5, 5, 5);
    const quads = quadsOf(mesh(p)[1]);
    expect(quads.length).toBe(6);
    expect(quads.reduce((s, q) => s + q.area, 0)).toBe(10);
  });

  test("different-state glass pair: 10 quads, shared face hidden from both sides", () => {
    const p = pad();
    setP(p, 5, 5, 5, 5);
    setP(p, 6, 5, 5, 6);
    const quads = quadsOf(mesh(p)[1]);
    expect(quads.length).toBe(10);
    expect(areaByDir(quads)).toEqual(refCounts(p).perDir);
  });

  test("matte beside glass: matte shows 6 quads, glass 5", () => {
    const p = pad();
    setP(p, 5, 5, 5, 1);
    setP(p, 6, 5, 5, 5);
    const geo = mesh(p);
    expect(quadsOf(geo[0]).length).toBe(6);
    expect(quadsOf(geo[1]).length).toBe(5);
  });

  test("gloss and emissive flags reach extra[1] / extra[2]", () => {
    const p = pad();
    setP(p, 5, 5, 5, 3);
    setP(p, 10, 5, 5, 4);
    const geo = mesh(p);
    const g = geo[0];
    expect(g).not.toBeNull();
    if (g === null) return;
    for (let i = 0; i < g.vertexCount; i++) {
      const white = g.color[i * 4] === 255 && g.color[i * 4 + 2] === 255;
      expect(g.extra[i * 4 + 1]).toBe(white ? 255 : 0);
      expect(g.extra[i * 4 + 2]).toBe(white ? 0 : 255);
    }
  });

  test("zero-shapes path stays byte-identical across calls", () => {
    const rand = mulberry32(99);
    const p = pad();
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (rand() < 0.3) setP(p, x, y, z, 1 + Math.floor(rand() * 6));
        }
      }
    }
    const first = mesh(p);
    const second = meshChunk(
      p,
      table,
      new Uint8Array(table.length),
      classes.opaque,
      classes.bucket,
      classes.gloss,
      classes.emissive,
    );
    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i++) {
      const a = first[i];
      const b = second[i];
      if (a === null || b === null) {
        expect(a).toBe(b);
        continue;
      }
      expect(b.vertexCount).toBe(a.vertexCount);
      expect(b.position).toEqual(a.position);
      expect(b.normal).toEqual(a.normal);
      expect(b.color).toEqual(a.color);
      expect(b.extra).toEqual(a.extra);
      expect(b.index).toEqual(a.index);
    }
  });

  test("lone bottom slab: 6 faces, total area 4, outward winding", () => {
    const p = pad();
    setP(p, 5, 5, 5, 2);
    const g = meshShaped(p)[0];
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(g.vertexCount).toBe(24);
    expect(g.index.length).toBe(36);
    checkWinding(g);
    const faces = facesOf(g);
    expect(faces.length).toBe(6);
    expect(faces.reduce((s, f) => s + f.area, 0)).toBeCloseTo(4, 5);
    for (const f of faces) expect(faceWithin(f, [5, 5, 5], [6, 5.5, 6])).toBe(true);
  });

  test("slab over cube: slab bottom culled, cube top kept", () => {
    const p = pad();
    setP(p, 5, 5, 5, 1);
    setP(p, 5, 6, 5, 2);
    const geo = meshShaped(p);
    const faces = facesOf(geo[0]);
    expect(faces.length).toBe(11);
    expect(findBoxFace(faces, [0, 1, 0], [5, 6, 5], [6, 6, 6])).toBeDefined();
    expect(findBoxFace(faces, [0, -1, 0], [5, 6, 5], [6, 6, 6])).toBeUndefined();
  });

  test("cube laterally beside slab keeps its side face", () => {
    const p = pad();
    setP(p, 5, 5, 5, 1);
    setP(p, 6, 5, 5, 2);
    const faces = facesOf(meshShaped(p)[0]);
    expect(faces.length).toBe(11);
    expect(findBoxFace(faces, [1, 0, 0], [6, 5, 5], [6, 6, 6])).toBeDefined();
    expect(findBoxFace(faces, [-1, 0, 0], [6, 5, 5], [6, 6, 6])).toBeUndefined();
  });

  test("lone +x ramp: 5 faces, area 3+sqrt2, slope normal", () => {
    const p = pad();
    setP(p, 5, 5, 5, 4);
    const g = meshShaped(p)[0];
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(g.vertexCount).toBe(18);
    expect(g.index.length).toBe(24);
    checkWinding(g);
    const faces = facesOf(g);
    expect(faces.length).toBe(5);
    expect(faces.reduce((s, f) => s + f.area, 0)).toBeCloseTo(3 + Math.SQRT2, 5);
    const slope = faces.find((f) => f.normal[0] < -0.5 && f.normal[1] > 0.5);
    expect(slope).toBeDefined();
    if (slope === undefined) return;
    expect(Math.abs(slope.normal[0] + Math.SQRT1_2)).toBeLessThan(0.01);
    expect(Math.abs(slope.normal[1] - Math.SQRT1_2)).toBeLessThan(0.01);
    expect(slope.normal[2]).toBe(0);
  });

  test("all four ramp orientations emit 5 in-cell outward faces", () => {
    for (const stateId of [4, 5, 6, 7]) {
      const p = pad();
      setP(p, 5, 5, 5, stateId);
      const g = meshShaped(p)[0];
      expect(g).not.toBeNull();
      if (g === null) continue;
      checkWinding(g);
      const faces = facesOf(g);
      expect(faces.length).toBe(5);
      for (const f of faces) expect(faceWithin(f, [5, 5, 5], [6, 6, 6])).toBe(true);
      const slopes = faces.filter((f) => f.normal.filter((c) => c !== 0).length === 2);
      expect(slopes.length).toBe(1);
    }
  });

  test("glass slab routes to bucket 1 with uniform extra", () => {
    const p = pad();
    setP(p, 5, 5, 5, 8);
    const geo = meshShaped(p);
    expect(geo.length).toBe(2);
    expect(geo[0]).toBeNull();
    const g = geo[1];
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(g.vertexCount).toBe(24);
    for (let i = 0; i < g.vertexCount; i++) {
      expect([g.extra[i * 4], g.extra[i * 4 + 1], g.extra[i * 4 + 2], g.extra[i * 4 + 3]]).toEqual([
        255, 0, 0, 0,
      ]);
    }
  });

  test("cube surrounded by 6 slabs still emits all 6 faces", () => {
    const p = pad();
    setP(p, 5, 5, 5, 1);
    setP(p, 4, 5, 5, 2);
    setP(p, 6, 5, 5, 2);
    setP(p, 5, 4, 5, 2);
    setP(p, 5, 6, 5, 2);
    setP(p, 5, 5, 4, 2);
    setP(p, 5, 5, 6, 2);
    const faces = facesOf(meshShaped(p)[0]);
    // 6 cube faces + 4 lateral slabs x5 + slab above x5 + slab below x6.
    expect(faces.length).toBe(37);
    for (let d = 0; d < 6; d++) {
      const normal = [FACE_NORMAL[d * 3], FACE_NORMAL[d * 3 + 1], FACE_NORMAL[d * 3 + 2]];
      const cubeFace = findBoxFace(faces, normal, [5, 5, 5], [6, 6, 6]);
      expect(cubeFace).toBeDefined();
      if (cubeFace !== undefined) expect(cubeFace.area).toBeCloseTo(1, 5);
    }
  });
});
