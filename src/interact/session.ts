/** EditSession factory bridging the world, gesture recorder, and undo stack. */
import type { VoxelWorld } from "../core/world";
import type { EditSession } from "./api";
import { type ApplyFn, GestureRecorder, type UndoStack } from "./undo";

export const createSessionFactory = (
  world: VoxelWorld,
  undo: UndoStack,
  onCommitted?: (cells: Int32Array) => void,
): (() => EditSession) => {
  const apply: ApplyFn = (x, y, z, s) => {
    world.set(x, y, z, s);
  };
  return () => {
    const rec = new GestureRecorder();
    let closed = false;
    return {
      set(x, y, z, s) {
        const before = world.get(x, y, z);
        if (!world.set(x, y, z, s)) return false;
        rec.record(x, y, z, before, s);
        return true;
      },
      get: (x, y, z) => world.get(x, y, z),
      get size() {
        return rec.size;
      },
      commit() {
        if (closed) return;
        closed = true;
        const cells = rec.build();
        if (cells) {
          undo.push(cells);
          onCommitted?.(cells);
        }
      },
      cancel() {
        if (closed) return;
        closed = true;
        rec.revert(apply);
      },
    };
  };
};
