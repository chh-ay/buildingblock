import { describe, expect, test } from "bun:test";
import { raycastGround, raycastVoxel } from "../src/core/raycast";
import { AIR, WORLD_SX, WORLD_SZ } from "../src/core/types";

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const key = (x: number, y: number, z: number): number => x + z * WORLD_SX + y * WORLD_SX * WORLD_SZ;

const makeWorld = () => {
  const cells = new Map<number, number>();
  const set = (x: number, y: number, z: number, s = 1): void => {
    cells.set(key(x, y, z), s);
  };
  const getState = (x: number, y: number, z: number): number => cells.get(key(x, y, z)) ?? AIR;
  return { set, getState };
};

/** Brute-force reference: march t in 0.004 steps, report first non-air cell. */
const bruteRay = (
  getState: (x: number, y: number, z: number) => number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): { x: number; y: number; z: number; face: number } | null => {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len === 0) return null;
  dx /= len;
  dy /= len;
  dz /= len;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let haveLast = false;
  for (let t = 1e-7; t <= maxDist; t += 0.004) {
    const x = Math.floor(ox + dx * t);
    const y = Math.floor(oy + dy * t);
    const z = Math.floor(oz + dz * t);
    if (haveLast && x === lx && y === ly && z === lz) continue;
    if (getState(x, y, z) !== AIR) {
      let face = -1;
      if (haveLast && Math.abs(x - lx) + Math.abs(y - ly) + Math.abs(z - lz) === 1) {
        face =
          x - lx === 1
            ? 1
            : x - lx === -1
              ? 0
              : y - ly === 1
                ? 3
                : y - ly === -1
                  ? 2
                  : z - lz === 1
                    ? 5
                    : 4;
      }
      return { x, y, z, face };
    }
    lx = x;
    ly = y;
    lz = z;
    haveLast = true;
  }
  return null;
};

describe("raycastVoxel axis-aligned", () => {
  const cases: [string, number[], number[], number][] = [
    ["+x", [5.5, 10.5, 10.5], [1, 0, 0], 1],
    ["-x", [15.5, 10.5, 10.5], [-1, 0, 0], 0],
    ["+y", [10.5, 5.5, 10.5], [0, 1, 0], 3],
    ["-y", [10.5, 15.5, 10.5], [0, -1, 0], 2],
    ["+z", [10.5, 10.5, 5.5], [0, 0, 1], 5],
    ["-z", [10.5, 10.5, 15.5], [0, 0, -1], 4],
  ];
  for (const [name, o, d, face] of cases) {
    test(`${name} hits block face ${face}`, () => {
      const w = makeWorld();
      w.set(10, 10, 10);
      const hit = raycastVoxel(w.getState, o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, 100);
      expect(hit).toEqual({ x: 10, y: 10, z: 10, face, ground: false });
    });
  }
});

describe("raycastVoxel traversal", () => {
  test("diagonal ray visits hand-computed cell sequence", () => {
    // origin (0.25, 10.5, 0.75), dir (1,0,1): boundary crossings at
    // z=1 (t*=0.25), x=1 (0.75), z=2 (1.25), x=2 (1.75), z=3 (2.25), x=3 (2.75)
    const w1 = makeWorld();
    w1.set(2, 10, 3);
    const hit1 = raycastVoxel(w1.getState, 0.25, 10.5, 0.75, 1, 0, 1, 100);
    expect(hit1).toEqual({ x: 2, y: 10, z: 3, face: 5, ground: false });

    const w2 = makeWorld();
    w2.set(3, 10, 3);
    const hit2 = raycastVoxel(w2.getState, 0.25, 10.5, 0.75, 1, 0, 1, 100);
    expect(hit2).toEqual({ x: 3, y: 10, z: 3, face: 1, ground: false });
  });

  test("origin outside AABB clips then hits with correct entry face", () => {
    const w = makeWorld();
    w.set(3, 10, 10);
    const hit = raycastVoxel(w.getState, -5, 10.5, 10.5, 1, 0, 0, 100);
    expect(hit).toEqual({ x: 3, y: 10, z: 10, face: 1, ground: false });
  });

  test("origin outside AABB, entry voxel solid: face from clip axis", () => {
    const w = makeWorld();
    w.set(0, 10, 10);
    const hit = raycastVoxel(w.getState, -5, 10.5, 10.5, 1, 0, 0, 100);
    expect(hit).toEqual({ x: 0, y: 10, z: 10, face: 1, ground: false });
  });

  test("origin inside a solid voxel returns it with dominant-axis face", () => {
    const w = makeWorld();
    w.set(10, 10, 10);
    const hit = raycastVoxel(w.getState, 10.5, 10.5, 10.5, 1, 0.2, 0.1, 100);
    expect(hit).toEqual({ x: 10, y: 10, z: 10, face: 1, ground: false });
  });

  test("ray exiting the world without hits returns null", () => {
    const w = makeWorld();
    expect(raycastVoxel(w.getState, 10.5, 10.5, 10.5, 1, 0, 0, 10000)).toBeNull();
    expect(raycastVoxel(w.getState, 10.5, 10.5, 10.5, -0.3, 0.9, 0.1, 10000)).toBeNull();
  });

  test("maxDist shorter than the block distance returns null", () => {
    const w = makeWorld();
    w.set(20, 10, 10);
    expect(raycastVoxel(w.getState, 10.5, 10.5, 10.5, 1, 0, 0, 5)).toBeNull();
    expect(raycastVoxel(w.getState, 10.5, 10.5, 10.5, 1, 0, 0, 100)).not.toBeNull();
  });

  test("zero direction components do not hang or produce NaN", () => {
    const w = makeWorld();
    w.set(10, 20, 10);
    const hit = raycastVoxel(w.getState, 10.5, 5.5, 10.5, 0, 1, 0, 100);
    expect(hit).toEqual({ x: 10, y: 20, z: 10, face: 3, ground: false });
    expect(raycastVoxel(w.getState, 10.5, 5.5, 10.5, 0, 0, 0, 100)).toBeNull();
    expect(raycastVoxel(w.getState, 0, 5.5, 10.5, 0, 1, 0, 100)).toBeNull();
  });
});

describe("raycastVoxel property", () => {
  test("300 seeded rays match brute-force reference", () => {
    const rand = mulberry32(0xb10c5);
    const w = makeWorld();
    const blocks: number[][] = [];
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rand() * 32);
      const y = Math.floor(rand() * 32);
      const z = Math.floor(rand() * 32);
      w.set(x, y, z);
      blocks.push([x, y, z]);
    }
    for (let i = 0; i < 300; i++) {
      const ox = rand() * 48 - 8;
      const oy = rand() * 48 - 8;
      const oz = rand() * 48 - 8;
      const b = blocks[Math.floor(rand() * blocks.length)]!;
      const dx = b[0]! + 0.5 - ox + (rand() - 0.5) * 2;
      const dy = b[1]! + 0.5 - oy + (rand() - 0.5) * 2;
      const dz = b[2]! + 0.5 - oz + (rand() - 0.5) * 2;
      const expected = bruteRay(w.getState, ox, oy, oz, dx, dy, dz, 200);
      const actual = raycastVoxel(w.getState, ox, oy, oz, dx, dy, dz, 200);
      if (expected === null) {
        expect(actual).toBeNull();
        continue;
      }
      expect(actual).not.toBeNull();
      expect([actual!.x, actual!.y, actual!.z]).toEqual([expected.x, expected.y, expected.z]);
      if (expected.face !== -1) expect(actual!.face).toBe(expected.face);
    }
  });
});

describe("raycastGround", () => {
  test("hits the baseplate inside bounds", () => {
    const hit = raycastGround(10.5, 5, 20.5, 0.5, -1, 0.25);
    expect(hit).toEqual({ x: 13, y: -1, z: 21, face: 2, ground: true });
  });

  test("misses when dy >= 0", () => {
    expect(raycastGround(10.5, 5, 20.5, 1, 0, 0)).toBeNull();
    expect(raycastGround(10.5, 5, 20.5, 0, 1, 0)).toBeNull();
  });

  test("misses when the intersection lands outside XZ bounds", () => {
    expect(raycastGround(-10, 5, 20.5, 0, -1, 0)).toBeNull();
    expect(raycastGround(WORLD_SX - 0.5, 1, 20.5, 5, -1, 0)).toBeNull();
    expect(raycastGround(10.5, 5, WORLD_SZ + 3, 0, -1, 0)).toBeNull();
  });
});
