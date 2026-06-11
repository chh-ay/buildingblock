import { describe, expect, test } from "bun:test";
import { WORLD_SX, WORLD_SZ } from "../src/core/types";
import type { ApplyFn } from "../src/interact/undo";
import { GestureRecorder, UndoStack } from "../src/interact/undo";

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const cellKey = (x: number, y: number, z: number) => x + z * WORLD_SX + y * WORLD_SX * WORLD_SZ;

type FakeWorld = Map<number, number>;

const makeApply =
  (world: FakeWorld): ApplyFn =>
  (x, y, z, stateId) => {
    const key = cellKey(x, y, z);
    if (stateId === 0) world.delete(key);
    else world.set(key, stateId);
  };

describe("GestureRecorder", () => {
  test("dedupes a cell to net no-op when final after equals first before", () => {
    const rec = new GestureRecorder();
    rec.record(1, 2, 3, 10, 20);
    rec.record(1, 2, 3, 20, 30);
    rec.record(1, 2, 3, 30, 10);
    expect(rec.size).toBe(1);
    expect(rec.build()).toBeNull();
  });

  test("dedupes a cell to first before / last after", () => {
    const rec = new GestureRecorder();
    rec.record(1, 2, 3, 10, 20);
    rec.record(1, 2, 3, 20, 30);
    expect(rec.size).toBe(1);
    const cells = rec.build();
    expect(cells).not.toBeNull();
    expect(Array.from(cells as Int32Array)).toEqual([1, 2, 3, 10, 30]);
  });

  test("build drops only no-op cells and preserves insertion order", () => {
    const rec = new GestureRecorder();
    rec.record(5, 0, 0, 1, 2);
    rec.record(6, 0, 0, 3, 3);
    rec.record(7, 0, 0, 4, 5);
    const cells = rec.build() as Int32Array;
    expect(Array.from(cells)).toEqual([5, 0, 0, 1, 2, 7, 0, 0, 4, 5]);
  });

  test("revert applies before-values in reverse insertion order", () => {
    const rec = new GestureRecorder();
    rec.record(1, 0, 0, 11, 21);
    rec.record(2, 0, 0, 12, 22);
    rec.record(3, 0, 0, 13, 23);
    const log: number[][] = [];
    rec.revert((x, y, z, s) => log.push([x, y, z, s]));
    expect(log).toEqual([
      [3, 0, 0, 13],
      [2, 0, 0, 12],
      [1, 0, 0, 11],
    ]);
  });

  test("revert restores the exact original world under overlapping writes", () => {
    const world: FakeWorld = new Map();
    world.set(cellKey(4, 1, 4), 7);
    world.set(cellKey(5, 1, 4), 8);
    const initial = new Map(world);
    const apply = makeApply(world);
    const rec = new GestureRecorder();
    rec.record(4, 1, 4, 7, 100);
    apply(4, 1, 4, 100);
    rec.record(5, 1, 4, 8, 100);
    apply(5, 1, 4, 100);
    rec.record(4, 1, 4, 100, 200);
    apply(4, 1, 4, 200);
    rec.record(5, 1, 4, 100, 0);
    apply(5, 1, 4, 0);
    expect(world).not.toEqual(initial);
    rec.revert(apply);
    expect(world).toEqual(initial);
  });

  test("clear resets size and build", () => {
    const rec = new GestureRecorder();
    rec.record(1, 1, 1, 0, 9);
    rec.clear();
    expect(rec.size).toBe(0);
    expect(rec.build()).toBeNull();
  });
});

describe("UndoStack", () => {
  test("undo/redo are false on empty stacks", () => {
    const stack = new UndoStack();
    const noop: ApplyFn = () => {};
    expect(stack.undo(noop)).toBe(false);
    expect(stack.redo(noop)).toBe(false);
  });

  test("seeded random batches roundtrip: undo all → initial, redo all → final", () => {
    const rand = mulberry32(1234);
    const world: FakeWorld = new Map();
    const apply = makeApply(world);
    const stack = new UndoStack();
    const initial = new Map(world);
    for (let batch = 0; batch < 12; batch++) {
      const rec = new GestureRecorder();
      const writes = 1 + Math.floor(rand() * 20);
      for (let i = 0; i < writes; i++) {
        const x = Math.floor(rand() * 16);
        const y = Math.floor(rand() * 4);
        const z = Math.floor(rand() * 16);
        const before = world.get(cellKey(x, y, z)) ?? 0;
        const after = Math.floor(rand() * 5);
        rec.record(x, y, z, before, after);
        apply(x, y, z, after);
      }
      const cells = rec.build();
      if (cells !== null) stack.push(cells);
    }
    const final = new Map(world);
    const pushed = stack.depth;
    while (stack.undo(apply)) {}
    expect(stack.depth).toBe(0);
    expect(stack.redoDepth).toBe(pushed);
    expect(world).toEqual(initial);
    while (stack.redo(apply)) {}
    expect(stack.redoDepth).toBe(0);
    expect(stack.depth).toBe(pushed);
    expect(world).toEqual(final);
  });

  test("interleaved undo/undo/redo lands on the intermediate state", () => {
    const world: FakeWorld = new Map();
    const apply = makeApply(world);
    const stack = new UndoStack();
    const snapshots: FakeWorld[] = [new Map(world)];
    for (let i = 0; i < 3; i++) {
      const rec = new GestureRecorder();
      const before = world.get(cellKey(i, 0, 0)) ?? 0;
      rec.record(i, 0, 0, before, i + 1);
      apply(i, 0, 0, i + 1);
      stack.push(rec.build() as Int32Array);
      snapshots.push(new Map(world));
    }
    expect(stack.undo(apply)).toBe(true);
    expect(stack.undo(apply)).toBe(true);
    expect(world).toEqual(snapshots[1] as FakeWorld);
    expect(stack.redo(apply)).toBe(true);
    expect(world).toEqual(snapshots[2] as FakeWorld);
    expect(stack.depth).toBe(2);
    expect(stack.redoDepth).toBe(1);
  });

  test("push clears redo", () => {
    const world: FakeWorld = new Map();
    const apply = makeApply(world);
    const stack = new UndoStack();
    stack.push(Int32Array.of(0, 0, 0, 0, 1));
    stack.push(Int32Array.of(1, 0, 0, 0, 2));
    stack.undo(apply);
    expect(stack.redoDepth).toBe(1);
    stack.push(Int32Array.of(2, 0, 0, 0, 3));
    expect(stack.redoDepth).toBe(0);
    expect(stack.redo(apply)).toBe(false);
  });

  test("maxEntries=3 keeps the 3 newest of 5 pushes", () => {
    const stack = new UndoStack(32 << 20, 3);
    for (let i = 0; i < 5; i++) stack.push(Int32Array.of(i, 0, 0, 0, i + 1));
    expect(stack.depth).toBe(3);
    const undone: number[] = [];
    while (stack.undo((x) => undone.push(x))) {}
    expect(undone).toEqual([4, 3, 2]);
  });

  test("tiny maxBytes evicts oldest until within budget, keeping the newest", () => {
    const entryBytes = 5 * 4;
    const stack = new UndoStack(entryBytes * 2, 256);
    for (let i = 0; i < 4; i++) stack.push(Int32Array.of(i, 0, 0, 0, i + 1));
    expect(stack.depth).toBe(2);
    const undone: number[] = [];
    while (stack.undo((x) => undone.push(x))) {}
    expect(undone).toEqual([3, 2]);
  });

  test("an entry alone over budget is never evicted by its own push", () => {
    const stack = new UndoStack(8, 256);
    stack.push(new Int32Array(10 * 5));
    expect(stack.depth).toBe(1);
    stack.push(new Int32Array(10 * 5));
    expect(stack.depth).toBe(1);
  });

  test("clear drops both stacks", () => {
    const apply: ApplyFn = () => {};
    const stack = new UndoStack();
    stack.push(Int32Array.of(0, 0, 0, 0, 1));
    stack.push(Int32Array.of(1, 0, 0, 0, 2));
    stack.undo(apply);
    stack.clear();
    expect(stack.depth).toBe(0);
    expect(stack.redoDepth).toBe(0);
  });
});
