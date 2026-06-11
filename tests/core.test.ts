import { describe, expect, test } from "bun:test";
import { Chunk } from "../src/core/chunk";
import { buildPadded } from "../src/core/padded";
import {
  AIR,
  BOUNDARY,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  cIndex,
  PAD_VOLUME,
  pIndex,
  SHAPE_RAMP_PX,
  SHAPE_SLAB_BOTTOM,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
} from "../src/core/types";
import { VoxelWorld } from "../src/core/world";

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("Chunk", () => {
  test("set/get roundtrip with air overwrites tracks nonAir", () => {
    const rand = mulberry32(1234);
    const chunk = new Chunk();
    const ref = new Uint16Array(CHUNK_VOLUME);
    for (let i = 0; i < 5000; i++) {
      const vi = (rand() * CHUNK_VOLUME) | 0;
      const id = (rand() * 8) | 0;
      const changed = chunk.setState(vi, id);
      expect(changed).toBe(ref[vi] !== id);
      ref[vi] = id;
    }
    let count = 0;
    for (let vi = 0; vi < CHUNK_VOLUME; vi++) {
      expect(chunk.getState(vi)).toBe(ref[vi]);
      if (ref[vi] !== AIR) count++;
    }
    expect(chunk.nonAir).toBe(count);
  });

  test("palette compaction keeps chunk paletted under churn", () => {
    const chunk = new Chunk();
    for (let id = 1; id <= 300; id++) {
      const vi = (id - 1) % 100;
      chunk.setState(vi, id);
    }
    expect(chunk.isDirect).toBe(false);
    for (let vi = 0; vi < 100; vi++) expect(chunk.getState(vi)).toBe(201 + vi);
    expect(chunk.nonAir).toBe(100);
  });

  test("palette overflow upgrades to direct mode with correct reads", () => {
    const chunk = new Chunk();
    for (let id = 1; id <= 300; id++) chunk.setState(id - 1, id);
    expect(chunk.isDirect).toBe(true);
    for (let id = 1; id <= 300; id++) expect(chunk.getState(id - 1)).toBe(id);
    expect(chunk.nonAir).toBe(300);
  });

  test("fromStates/readStates roundtrip; all-air gives null", () => {
    const rand = mulberry32(42);
    const states = new Uint16Array(CHUNK_VOLUME);
    let nonAir = 0;
    for (let i = 0; i < 2000; i++) {
      const vi = (rand() * CHUNK_VOLUME) | 0;
      if (states[vi] === AIR) nonAir++;
      states[vi] = 1 + ((rand() * 30) | 0);
    }
    const chunk = Chunk.fromStates(states);
    expect(chunk).not.toBeNull();
    expect(chunk!.nonAir).toBe(nonAir);
    const out = new Uint16Array(CHUNK_VOLUME);
    chunk!.readStates(out);
    expect(out).toEqual(states);
    expect(Chunk.fromStates(new Uint16Array(CHUNK_VOLUME))).toBeNull();
  });
});

describe("VoxelWorld", () => {
  test("cross-chunk set/get at chunk borders", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 0xff0000);
    expect(w.set(31, 31, 31, id)).toBe(true);
    expect(w.set(32, 32, 32, id)).toBe(true);
    expect(w.get(31, 31, 31)).toBe(id);
    expect(w.get(32, 32, 32)).toBe(id);
    expect(w.get(31, 32, 31)).toBe(AIR);
  });

  test("out-of-bounds set false, get AIR", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 0x00ff00);
    expect(w.set(-1, 0, 0, id)).toBe(false);
    expect(w.set(WORLD_SX, 0, 0, id)).toBe(false);
    expect(w.set(0, WORLD_SY, 0, id)).toBe(false);
    expect(w.get(-1, 0, 0)).toBe(AIR);
    expect(w.get(0, 0, WORLD_SZ)).toBe(AIR);
  });

  test("internState dedupes and stateCount grows", () => {
    const w = new VoxelWorld();
    const a = w.internState(0, 0x123456);
    const b = w.internState(1, 0x123456);
    expect(w.internState(0, 0x123456)).toBe(a);
    expect(a).not.toBe(b);
    expect(w.stateCount).toBe(3);
  });

  test("internState: same cls/rgb with different shape interns distinct ids", () => {
    const w = new VoxelWorld();
    const cube = w.internState(0, 0x336699);
    const slab = w.internState(0, 0x336699, SHAPE_SLAB_BOTTOM);
    const ramp = w.internState(0, 0x336699, SHAPE_RAMP_PX);
    expect(new Set([cube, slab, ramp]).size).toBe(3);
    expect(w.internState(0, 0x336699, SHAPE_SLAB_BOTTOM)).toBe(slab);
    expect(w.stateTable[cube]).toBe(w.stateTable[slab]);
    expect(w.stateShapes[cube]).toBe(0);
    expect(w.stateShapes[slab]).toBe(SHAPE_SLAB_BOTTOM);
    expect(w.stateShapes[ramp]).toBe(SHAPE_RAMP_PX);
  });

  test("dirty set: interior edit hits only own chunk", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 1);
    const dirty = new Set<number>();
    w.onDirty = (ci) => dirty.add(ci);
    w.set(40, 40, 40, id);
    expect(dirty).toEqual(new Set([cIndex(1, 1, 1)]));
  });

  test("dirty set: face edit hits own + existing neighbor", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 1);
    w.set(33, 1, 1, id);
    const dirty = new Set<number>();
    w.onDirty = (ci) => dirty.add(ci);
    w.set(31, 1, 1, id);
    expect(dirty).toEqual(new Set([cIndex(0, 0, 0), cIndex(1, 0, 0)]));
  });

  test("dirty set: corner edit with all neighbors populated hits 8 chunks", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 1);
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++)
        for (let dx = 0; dx <= 1; dx++) w.set(dx * 32 + 16, dy * 32 + 16, dz * 32 + 16, id);
    const dirty = new Set<number>();
    w.onDirty = (ci) => dirty.add(ci);
    w.set(32, 32, 32, id);
    const want = new Set<number>();
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) want.add(cIndex(dx, dy, dz));
    expect(dirty).toEqual(want);
  });

  test("chunk slot freed when emptied", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 1);
    const ci = cIndex(2, 1, 3);
    w.set(2 * 32 + 5, 32 + 5, 3 * 32 + 5, id);
    expect(w.chunks[ci]).not.toBeNull();
    expect(w.set(2 * 32 + 5, 32 + 5, 3 * 32 + 5, AIR)).toBe(true);
    expect(w.chunks[ci]).toBeNull();
    expect(w.voxelCount()).toBe(0);
  });

  test("snapshot roundtrip preserves voxels, count, and states", () => {
    const rand = mulberry32(777);
    const w = new VoxelWorld();
    const ids: number[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(w.internState((rand() * 4) | 0, (rand() * 0xffffff) | 0, (rand() * 7) | 0));
    }
    for (let i = 0; i < 10000; i++) {
      const x = (rand() * WORLD_SX) | 0;
      const y = (rand() * WORLD_SY) | 0;
      const z = (rand() * WORLD_SZ) | 0;
      w.set(x, y, z, ids[(rand() * ids.length) | 0]);
    }
    const snap = w.toSnapshot();
    const w2 = new VoxelWorld();
    const dirty = new Set<number>();
    w2.onDirty = (ci) => dirty.add(ci);
    w2.loadSnapshot(snap);
    expect(dirty.size).toBe(256);
    expect(w2.voxelCount()).toBe(w.voxelCount());
    expect(w2.stateTable).toEqual(w.stateTable);
    expect(w2.stateShapes).toEqual(w.stateShapes);
    const sample = mulberry32(999);
    for (let i = 0; i < 5000; i++) {
      const x = (sample() * WORLD_SX) | 0;
      const y = (sample() * WORLD_SY) | 0;
      const z = (sample() * WORLD_SZ) | 0;
      expect(w2.get(x, y, z)).toBe(w.get(x, y, z));
    }
  });

  test("loadSnapshot throws on dim mismatch", () => {
    const w = new VoxelWorld();
    const snap = w.toSnapshot();
    expect(() => w.loadSnapshot({ ...snap, sx: 64 })).toThrow(Error);
  });

  test("loadSnapshot throws on stateShapes/stateTable length mismatch", () => {
    const w = new VoxelWorld();
    const snap = w.toSnapshot();
    expect(() => w.loadSnapshot({ ...snap, stateShapes: new Uint8Array(2) })).toThrow(
      "snapshot tables length mismatch",
    );
  });

  test("clear empties world and fires dirty for occupied chunks", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 1);
    w.set(5, 5, 5, id);
    w.set(100, 100, 100, id);
    const dirty = new Set<number>();
    w.onDirty = (ci) => dirty.add(ci);
    w.clear();
    expect(dirty.size).toBe(2);
    expect(w.voxelCount()).toBe(0);
    expect(w.stateTable).toEqual([0]);
    expect(w.stateShapes).toEqual([0]);
  });
});

describe("buildPadded", () => {
  test("cy=0 chunk: interior, neighbor shell, and BOUNDARY below baseplate", () => {
    const rand = mulberry32(2024);
    const w = new VoxelWorld();
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(w.internState(0, i + 1));
    for (let i = 0; i < 4000; i++) {
      const x = 32 + ((rand() * 96) | 0) - 32;
      const y = (rand() * 64) | 0;
      const z = 32 + ((rand() * 96) | 0) - 32;
      w.set(x, y, z, ids[(rand() * ids.length) | 0]);
    }
    const ci = cIndex(1, 0, 1);
    const p = buildPadded(w, ci);
    expect(p.length).toBe(PAD_VOLUME);
    for (let ly = -1; ly <= CHUNK_SIZE; ly++) {
      for (let lz = -1; lz <= CHUNK_SIZE; lz++) {
        for (let lx = -1; lx <= CHUNK_SIZE; lx++) {
          const wy = ly;
          const want = wy < 0 ? BOUNDARY : w.get(32 + lx, wy, 32 + lz);
          expect(p[pIndex(lx, ly, lz)]).toBe(want);
        }
      }
    }
  });

  test("corner chunk: AIR beyond world edges, null chunk interior all AIR", () => {
    const w = new VoxelWorld();
    const id = w.internState(0, 0xabcdef);
    const ci = cIndex(7, 3, 7);
    w.set(WORLD_SX - 1, WORLD_SY - 1, WORLD_SZ - 1, id);
    w.set(WORLD_SX - 33, WORLD_SY - 1, WORLD_SZ - 1, id);
    const p = buildPadded(w, ci);
    expect(p[pIndex(31, 31, 31)]).toBe(id);
    expect(p[pIndex(-1, 31, 31)]).toBe(id);
    expect(p[pIndex(32, 31, 31)]).toBe(AIR);
    expect(p[pIndex(31, 32, 31)]).toBe(AIR);
    expect(p[pIndex(31, 31, 32)]).toBe(AIR);
    const empty = buildPadded(w, cIndex(0, 1, 0));
    for (let vi = 0; vi < PAD_VOLUME; vi++) expect(empty[vi]).toBe(AIR);
  });

  test("reuses provided out buffer and overwrites stale data", () => {
    const w = new VoxelWorld();
    const out = new Uint16Array(PAD_VOLUME).fill(1234);
    const p = buildPadded(w, cIndex(3, 2, 3), out);
    expect(p).toBe(out);
    for (let vi = 0; vi < PAD_VOLUME; vi++) expect(p[vi]).toBe(AIR);
  });
});
