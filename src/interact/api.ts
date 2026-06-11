/**
 * Tool layer contracts. Tools are pure gesture logic: they receive rays/hits,
 * preview via ghosts, and write voxels through an EditSession. The input router
 * owns DOM events and calls these hooks; tools never touch the DOM or three.js.
 *
 * Gesture protocol:
 * - down() records the anchor (no world writes), move() updates ghost previews,
 *   up() applies all writes through one EditSession and commits it.
 * - cancel() (Esc / pointer lost) clears previews and reverts any applied writes.
 */
import type { RayHit } from "../core/types";
import type { VoxelWorld } from "../core/world";

export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface ToolPointer {
  ray: Ray;
  hit: RayHit | null;
}

/**
 * One undoable gesture. set() applies to the world immediately; commit() pushes
 * a single undo command; cancel() reverts everything this session applied.
 */
export interface EditSession {
  set(x: number, y: number, z: number, stateId: number): boolean;
  get(x: number, y: number, z: number): number;
  /** Number of voxels changed so far. */
  readonly size: number;
  commit(): void;
  cancel(): void;
}

export interface ToolEnv {
  world: VoxelWorld;
  /** Currently selected block state, already interned. */
  state(): number;
  begin(): EditSession;
  /**
   * Preview cells as ghost instances; cells = xyz triples, count = cell count.
   * Pass null to clear.
   */
  ghosts(cells: Int32Array | null, count?: number): void;
  /** Hover highlight (voxel outline + face). Pass null to clear. */
  hover(hit: RayHit | null): void;
  /** Eyedropper result: a stateId the router maps back into appState color/class. */
  pick(stateId: number): void;
}

export interface Tool {
  down(p: ToolPointer, env: ToolEnv): void;
  move(p: ToolPointer, env: ToolEnv): void;
  up(p: ToolPointer, env: ToolEnv): void;
  /** Return true when consumed (blocks camera dolly). Used for box height. */
  wheel(deltaY: number, env: ToolEnv): boolean;
  hover(p: ToolPointer, env: ToolEnv): void;
  cancel(env: ToolEnv): void;
}
