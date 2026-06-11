import { WORLD_SX, WORLD_SZ } from "../core/types";

/** Callback used to write a voxel state back into the world during undo/redo replay. */
export type ApplyFn = (x: number, y: number, z: number, stateId: number) => void;

const STRIDE = 5;

/** Accumulates per-cell before/after pairs for one gesture, deduped to first-before / last-after. */
export class GestureRecorder {
  private slots = new Map<number, number>();
  private buf = new Int32Array(64 * STRIDE);
  private count = 0;

  /** Records one cell write; repeat touches keep the first `before` and the last `after`. */
  record(x: number, y: number, z: number, before: number, after: number): void {
    const key = x + z * WORLD_SX + y * WORLD_SX * WORLD_SZ;
    const slot = this.slots.get(key);
    if (slot !== undefined) {
      this.buf[slot * STRIDE + 4] = after;
      return;
    }
    if (this.count * STRIDE === this.buf.length) {
      const next = new Int32Array(this.buf.length << 1);
      next.set(this.buf);
      this.buf = next;
    }
    const base = this.count * STRIDE;
    this.buf[base] = x;
    this.buf[base + 1] = y;
    this.buf[base + 2] = z;
    this.buf[base + 3] = before;
    this.buf[base + 4] = after;
    this.slots.set(key, this.count);
    this.count++;
  }

  /** Number of distinct cells recorded so far. */
  get size(): number {
    return this.count;
  }

  /** Replays `before` values in reverse insertion order, restoring the pre-gesture world. */
  revert(apply: ApplyFn): void {
    const b = this.buf;
    for (let i = this.count - 1; i >= 0; i--) {
      const base = i * STRIDE;
      apply(b[base], b[base + 1], b[base + 2], b[base + 3]);
    }
  }

  /** Packs surviving cells as [x,y,z,before,after] × n in insertion order; null if all net no-ops. */
  build(): Int32Array | null {
    const b = this.buf;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const base = i * STRIDE;
      if (b[base + 3] !== b[base + 4]) n++;
    }
    if (n === 0) return null;
    const out = new Int32Array(n * STRIDE);
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const base = i * STRIDE;
      if (b[base + 3] === b[base + 4]) continue;
      out[w] = b[base];
      out[w + 1] = b[base + 1];
      out[w + 2] = b[base + 2];
      out[w + 3] = b[base + 3];
      out[w + 4] = b[base + 4];
      w += STRIDE;
    }
    return out;
  }

  /** Resets the recorder for the next gesture. */
  clear(): void {
    this.slots.clear();
    this.count = 0;
  }
}

/** Bounded undo/redo history of packed gesture entries. */
export class UndoStack {
  private undoEntries: Int32Array[] = [];
  private redoEntries: Int32Array[] = [];
  private bytes = 0;

  constructor(
    private maxBytes = 32 << 20,
    private maxEntries = 256,
  ) {}

  /** Appends an entry, clears redo, and evicts oldest entries while over either cap. */
  push(cells: Int32Array): void {
    this.redoEntries.length = 0;
    this.undoEntries.push(cells);
    this.bytes += cells.byteLength;
    while (
      this.undoEntries.length > 1 &&
      (this.undoEntries.length > this.maxEntries || this.bytes > this.maxBytes)
    ) {
      this.bytes -= (this.undoEntries.shift() as Int32Array).byteLength;
    }
  }

  /** Replays the newest entry's before-values in reverse cell order; false when empty. */
  undo(apply: ApplyFn): boolean {
    const cells = this.undoEntries.pop();
    if (cells === undefined) return false;
    this.bytes -= cells.byteLength;
    for (let base = cells.length - STRIDE; base >= 0; base -= STRIDE) {
      apply(cells[base], cells[base + 1], cells[base + 2], cells[base + 3]);
    }
    this.redoEntries.push(cells);
    return true;
  }

  /** Replays the newest undone entry's after-values in forward order; false when empty. */
  redo(apply: ApplyFn): boolean {
    const cells = this.redoEntries.pop();
    if (cells === undefined) return false;
    for (let base = 0; base < cells.length; base += STRIDE) {
      apply(cells[base], cells[base + 1], cells[base + 2], cells[base + 4]);
    }
    this.undoEntries.push(cells);
    this.bytes += cells.byteLength;
    return true;
  }

  /** Entries available to undo. */
  get depth(): number {
    return this.undoEntries.length;
  }

  /** Entries available to redo. */
  get redoDepth(): number {
    return this.redoEntries.length;
  }

  /** Drops all history. */
  clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.bytes = 0;
  }
}
