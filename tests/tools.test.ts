import { describe, expect, test } from "bun:test";
import type { RayHit } from "../src/core/types";
import { AIR, WORLD_SX, WORLD_SZ } from "../src/core/types";
import type { VoxelWorld } from "../src/core/world";
import type { EditSession, Ray, ToolEnv } from "../src/interact/api";
import { adjacentCell, createTools, rayPlaneCell } from "../src/interact/tools";

const key = (x: number, y: number, z: number): number => x + z * WORLD_SX + y * WORLD_SX * WORLD_SZ;

interface FakeEnv {
  env: ToolEnv;
  cells: Map<number, number>;
  sets: [number, number, number, number][];
  ghostCalls: (number[] | null)[];
  hovers: (RayHit | null)[];
  picks: number[];
  counters: { begins: number; commits: number; cancels: number };
}

const makeEnv = (state = 7): FakeEnv => {
  const cells = new Map<number, number>();
  const sets: [number, number, number, number][] = [];
  const ghostCalls: (number[] | null)[] = [];
  const hovers: (RayHit | null)[] = [];
  const picks: number[] = [];
  const counters = { begins: 0, commits: 0, cancels: 0 };
  const session: EditSession = {
    set(x, y, z, stateId) {
      sets.push([x, y, z, stateId]);
      cells.set(key(x, y, z), stateId);
      return true;
    },
    get(x, y, z) {
      return cells.get(key(x, y, z)) ?? AIR;
    },
    get size() {
      return sets.length;
    },
    commit() {
      counters.commits++;
    },
    cancel() {
      counters.cancels++;
    },
  };
  const world = {
    get: (x: number, y: number, z: number) => cells.get(key(x, y, z)) ?? AIR,
  } as unknown as VoxelWorld;
  const env: ToolEnv = {
    world,
    state: () => state,
    begin: () => {
      counters.begins++;
      return session;
    },
    ghosts: (buf, count) => {
      ghostCalls.push(buf ? Array.from(buf.slice(0, (count ?? 0) * 3)) : null);
    },
    hover: (hit) => {
      hovers.push(hit);
    },
    pick: (stateId) => {
      picks.push(stateId);
    },
  };
  return { env, cells, sets, ghostCalls, hovers, picks, counters };
};

const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray => ({
  ox,
  oy,
  oz,
  dx,
  dy,
  dz,
});

const downRayAt = (x: number, z: number): Ray => ray(x + 0.5, 50, z + 0.5, 0, -1, 0);

const groundHit = (x: number, z: number): RayHit => ({ x, y: -1, z, face: 2, ground: true });

const voxelHit = (x: number, y: number, z: number, face: number): RayHit => ({
  x,
  y,
  z,
  face,
  ground: false,
});

const cellSet = (flat: number[] | null): Set<string> => {
  const out = new Set<string>();
  if (!flat) return out;
  for (let i = 0; i < flat.length; i += 3) out.add(`${flat[i]},${flat[i + 1]},${flat[i + 2]}`);
  return out;
};

describe("adjacentCell", () => {
  test("offsets along each face normal", () => {
    expect(adjacentCell(voxelHit(5, 5, 5, 0))).toEqual([6, 5, 5]);
    expect(adjacentCell(voxelHit(5, 5, 5, 1))).toEqual([4, 5, 5]);
    expect(adjacentCell(voxelHit(5, 5, 5, 2))).toEqual([5, 6, 5]);
    expect(adjacentCell(voxelHit(5, 5, 5, 3))).toEqual([5, 4, 5]);
    expect(adjacentCell(voxelHit(5, 5, 5, 4))).toEqual([5, 5, 6]);
    expect(adjacentCell(voxelHit(5, 5, 5, 5))).toEqual([5, 5, 4]);
  });

  test("ground hit maps to baseplate cell at y=0", () => {
    expect(adjacentCell(groundHit(2, 2))).toEqual([2, 0, 2]);
  });
});

describe("rayPlaneCell", () => {
  test("straight-down ray lands in the right cell", () => {
    const out: [number, number, number] = [-1, -1, -1];
    expect(rayPlaneCell(downRayAt(5, 4), 1, 0, out)).toBe(true);
    expect(out).toEqual([5, 0, 4]);
  });

  test("parallel ray returns false", () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(rayPlaneCell(ray(0, 10, 0, 1, 0, 0), 1, 0, out)).toBe(false);
  });

  test("plane behind origin returns false", () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(rayPlaneCell(ray(5.5, 10, 4.5, 0, 1, 0), 1, 0, out)).toBe(false);
  });

  test("axis coordinate is forced exact on slanted rays", () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(rayPlaneCell(ray(0.1, 10, 0.1, 0.3, -1, 0.2), 1, 3, out)).toBe(true);
    expect(out[1]).toBe(3);
    expect(out[0]).toBe(Math.floor(0.1 + 6.5 * 0.3));
    expect(out[2]).toBe(Math.floor(0.1 + 6.5 * 0.2));
  });
});

describe("place", () => {
  test("ground drag previews the AIR rect and commits it once", () => {
    const f = makeEnv(7);
    f.cells.set(key(3, 0, 3), 9);
    const tool = createTools().place;
    tool.down({ ray: downRayAt(2, 2), hit: groundHit(2, 2) }, f.env);
    expect(f.hovers.at(-1)).toBeNull();
    expect(cellSet(f.ghostCalls.at(-1) ?? null)).toEqual(new Set(["2,0,2"]));
    tool.move({ ray: downRayAt(5, 4), hit: null }, f.env);
    const ghost = cellSet(f.ghostCalls.at(-1) ?? null);
    expect(ghost.size).toBe(11);
    expect(ghost.has("3,0,3")).toBe(false);
    for (let x = 2; x <= 5; x++) {
      for (let z = 2; z <= 4; z++) {
        if (x === 3 && z === 3) continue;
        expect(ghost.has(`${x},0,${z}`)).toBe(true);
      }
    }
    tool.up({ ray: downRayAt(5, 4), hit: null }, f.env);
    expect(f.counters).toEqual({ begins: 1, commits: 1, cancels: 0 });
    expect(f.sets.length).toBe(11);
    for (const [, , , s] of f.sets) expect(s).toBe(7);
    expect(f.sets.some(([x, , z]) => x === 3 && z === 3)).toBe(false);
    expect(f.ghostCalls.at(-1)).toBeNull();
  });

  test("cancel clears ghosts and aborts the gesture", () => {
    const f = makeEnv();
    const tool = createTools().place;
    tool.down({ ray: downRayAt(2, 2), hit: groundHit(2, 2) }, f.env);
    tool.cancel(f.env);
    expect(f.ghostCalls.at(-1)).toBeNull();
    tool.up({ ray: downRayAt(2, 2), hit: null }, f.env);
    expect(f.counters.begins).toBe(0);
  });
});

describe("erase", () => {
  test("rect on the +y face of a 3x3 slab erases only existing voxels", () => {
    const f = makeEnv();
    for (let x = 10; x <= 12; x++) for (let z = 10; z <= 12; z++) f.cells.set(key(x, 0, z), 5);
    const tool = createTools().erase;
    tool.down({ ray: downRayAt(10, 10), hit: voxelHit(10, 0, 10, 2) }, f.env);
    tool.move({ ray: downRayAt(13, 13), hit: null }, f.env);
    const ghost = cellSet(f.ghostCalls.at(-1) ?? null);
    expect(ghost.size).toBe(9);
    expect(ghost.has("13,0,13")).toBe(false);
    tool.up({ ray: downRayAt(13, 13), hit: null }, f.env);
    expect(f.sets.length).toBe(9);
    for (const [, , , s] of f.sets) expect(s).toBe(AIR);
    expect(f.counters).toEqual({ begins: 1, commits: 1, cancels: 0 });
  });

  test("ignores ground hits", () => {
    const f = makeEnv();
    const tool = createTools().erase;
    tool.down({ ray: downRayAt(2, 2), hit: groundHit(2, 2) }, f.env);
    expect(f.ghostCalls.length).toBe(0);
    tool.up({ ray: downRayAt(2, 2), hit: null }, f.env);
    expect(f.counters.begins).toBe(0);
  });
});

describe("paint", () => {
  test("repaints only non-air cells with the current state", () => {
    const f = makeEnv(33);
    f.cells.set(key(20, 0, 20), 5);
    f.cells.set(key(22, 0, 22), 5);
    const tool = createTools().paint;
    tool.down({ ray: downRayAt(20, 20), hit: voxelHit(20, 0, 20, 2) }, f.env);
    tool.move({ ray: downRayAt(22, 22), hit: null }, f.env);
    expect(cellSet(f.ghostCalls.at(-1) ?? null)).toEqual(new Set(["20,0,20", "22,0,22"]));
    tool.up({ ray: downRayAt(22, 22), hit: null }, f.env);
    expect(f.sets).toEqual([
      [20, 0, 20, 33],
      [22, 0, 22, 33],
    ]);
    expect(f.counters.commits).toBe(1);
  });
});

describe("box", () => {
  test("wheel during gesture grows height upward from a +y face", () => {
    const f = makeEnv(7);
    f.cells.set(key(4, 0, 4), 5);
    const tool = createTools().box;
    tool.down({ ray: downRayAt(4, 4), hit: voxelHit(4, 0, 4, 2) }, f.env);
    expect(tool.wheel(-100, f.env)).toBe(true);
    expect(tool.wheel(-100, f.env)).toBe(true);
    tool.move({ ray: downRayAt(5, 5), hit: null }, f.env);
    const ghost = cellSet(f.ghostCalls.at(-1) ?? null);
    expect(ghost.size).toBe(12);
    for (let y = 1; y <= 3; y++) {
      for (let x = 4; x <= 5; x++) {
        for (let z = 4; z <= 5; z++) expect(ghost.has(`${x},${y},${z}`)).toBe(true);
      }
    }
    tool.up({ ray: downRayAt(5, 5), hit: null }, f.env);
    expect(f.sets.length).toBe(12);
    expect(f.counters).toEqual({ begins: 1, commits: 1, cancels: 0 });
  });

  test("skips occupied cells inside the volume", () => {
    const f = makeEnv(7);
    f.cells.set(key(4, 0, 4), 5);
    f.cells.set(key(4, 2, 4), 9);
    const tool = createTools().box;
    tool.down({ ray: downRayAt(4, 4), hit: voxelHit(4, 0, 4, 2) }, f.env);
    tool.wheel(-100, f.env);
    tool.wheel(-100, f.env);
    expect(cellSet(f.ghostCalls.at(-1) ?? null)).toEqual(new Set(["4,1,4", "4,3,4"]));
  });

  test("-x face stacks in -x", () => {
    const f = makeEnv(7);
    f.cells.set(key(10, 5, 10), 5);
    const tool = createTools().box;
    const r = ray(0, 5.5, 10.5, 1, 0, 0);
    tool.down({ ray: r, hit: voxelHit(10, 5, 10, 1) }, f.env);
    tool.wheel(-100, f.env);
    expect(cellSet(f.ghostCalls.at(-1) ?? null)).toEqual(new Set(["9,5,10", "8,5,10"]));
  });

  test("wheel clamps at 1 and returns false when idle", () => {
    const f = makeEnv(7);
    const tool = createTools().box;
    expect(tool.wheel(-100, f.env)).toBe(false);
    tool.down({ ray: downRayAt(4, 4), hit: groundHit(4, 4) }, f.env);
    expect(tool.wheel(100, f.env)).toBe(true);
    expect(cellSet(f.ghostCalls.at(-1) ?? null)).toEqual(new Set(["4,0,4"]));
    tool.cancel(f.env);
    expect(tool.wheel(-100, f.env)).toBe(false);
  });
});

describe("clamping", () => {
  test("rect target coords below 0 clamp to 0", () => {
    const f = makeEnv(7);
    const tool = createTools().place;
    tool.down({ ray: downRayAt(0, 0), hit: groundHit(0, 0) }, f.env);
    tool.move({ ray: downRayAt(-3, -2), hit: null }, f.env);
    expect(cellSet(f.ghostCalls.at(-1) ?? null)).toEqual(new Set(["0,0,0"]));
  });
});

describe("pick", () => {
  test("fires env.pick with the voxel state and never begins a session", () => {
    const f = makeEnv();
    f.cells.set(key(3, 2, 3), 42);
    const tool = createTools().pick;
    tool.down({ ray: downRayAt(3, 3), hit: voxelHit(3, 2, 3, 2) }, f.env);
    expect(f.picks).toEqual([42]);
    expect(f.counters.begins).toBe(0);
    tool.down({ ray: downRayAt(3, 3), hit: groundHit(3, 3) }, f.env);
    expect(f.picks).toEqual([42]);
    tool.cancel(f.env);
    expect(f.ghostCalls.at(-1)).toBeNull();
  });
});
