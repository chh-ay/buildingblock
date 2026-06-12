/**
 * Interactive editing glue: the juiced ToolEnv handed to the gesture machines
 * (sounds, particles, autosave release), placement-shape resolution, the
 * eyedropper, and undo/redo wrapped for collab rebroadcast.
 */
import {
  AIR,
  inWorld,
  type RayHit,
  SHAPE_FAMILIES,
  shapeFamilyIndex,
  shapeOrientationIndex,
  stateClass,
  stateRgb,
} from "../core/types";
import type { VoxelWorld } from "../core/world";
import type { EditSession, ToolEnv } from "../interact/api";
import { createSessionFactory } from "../interact/session";
import { adjacentCell } from "../interact/tools";
import type { ApplyFn, UndoStack } from "../interact/undo";
import type { SaveStore } from "../io/saves";
import type { CameraRig } from "../render/camera";
import type { Highlighter } from "../render/highlight";
import type { VoxelFx } from "../render/particles";
import type { SoundEngine } from "../sound";
import type { AppState } from "../state";
import type { Collab } from "./collab";

/** Confetti on destruction, snap flash on creation/paint. Returns true when something spawned. */
export type SpawnEditFx = (
  x: number,
  y: number,
  z: number,
  prevId: number,
  nextId: number,
) => boolean;

export const createEditFx = (world: VoxelWorld, fx: VoxelFx): SpawnEditFx => {
  return (x, y, z, prevId, nextId) => {
    if (nextId === AIR) {
      if (prevId === AIR) return false;
      fx.burst(x, y, z, stateRgb(world.stateTable[prevId] ?? 0));
      return true;
    }

    fx.flash(x, y, z, stateRgb(world.stateTable[nextId] ?? 0));
    return true;
  };
};

export interface EditingDeps {
  world: VoxelWorld;
  undo: UndoStack;
  state: AppState;
  sound: SoundEngine;
  saves: SaveStore;
  highlight: Highlighter;
  cameraRig: CameraRig;
  collab: Collab;
  spawnEditFx: SpawnEditFx;
}

export interface Editing {
  toolEnv: ToolEnv;
  /** Concrete shape id for the next placement (explicit facing or camera auto). */
  shapeForPlacement(): number;
  /** Most recent hover hit, for hover-targeted commands like F-to-focus. */
  lastHover(): RayHit | null;
  runUndo(): void;
  runRedo(): void;
  pushRecentColor(rgb: number): void;
}

export const createEditing = (deps: EditingDeps): Editing => {
  const { world, undo, state, sound, saves, highlight, cameraRig, collab } = deps;

  let lastHoverHit: RayHit | null = null;

  /** Concrete shape id for placement: explicit facing when chosen, else away from the camera. */
  const shapeForPlacement = (): number => {
    const family = SHAPE_FAMILIES[state.family()];
    const { orientations } = family;
    if (orientations.length === 1) return orientations[0];

    const facing = state.facing();
    if (facing >= 0) return orientations[facing];

    const dx = cameraRig.controls.target.x - cameraRig.camera.position.x;
    const dz = cameraRig.controls.target.z - cameraRig.camera.position.z;
    return orientations[family.autoIndex?.(dx, dz) ?? 0];
  };

  const sessionFactory = createSessionFactory(world, undo, (cells) => collab.broadcastEdits(cells));
  let lastEditSoundAt = 0;

  /** Sessions wrapped for juice: throttled edit sounds, particles, autosave release. */
  const beginSession = (): EditSession => {
    saves.release();
    const session = sessionFactory();
    let fxBudget = 48;

    return {
      get size() {
        return session.size;
      },
      get: (x, y, z) => session.get(x, y, z),
      set: (x, y, z, stateId) => {
        const prevId = world.get(x, y, z);
        if (!session.set(x, y, z, stateId)) return false;

        if (fxBudget > 0 && deps.spawnEditFx(x, y, z, prevId, stateId)) fxBudget--;

        const now = performance.now();
        if (now - lastEditSoundAt >= 50) {
          lastEditSoundAt = now;
          sound.play(stateId === AIR ? "erase" : state.tool() === "paint" ? "paint" : "place");
        }
        return true;
      },
      commit: () => session.commit(),
      cancel: () => session.cancel(),
    };
  };

  const toolEnv: ToolEnv = {
    world,
    state: () => world.internState(state.cls(), state.color(), shapeForPlacement()),
    begin: beginSession,

    ghosts: (cells, count) =>
      highlight.setGhosts(
        cells,
        count ?? (cells ? cells.length / 3 : 0),
        state.tool() === "erase" ? 0xe0524d : state.color(),
      ),

    hover: (hit) => {
      lastHoverHit = hit;

      const tool = state.tool();
      let canPlace = false;
      if (hit && (tool === "place" || tool === "box")) {
        const [ax, ay, az] = adjacentCell(hit);
        canPlace = inWorld(ax, ay, az) && world.get(ax, ay, az) === AIR;
      }

      highlight.setHover(hit, tool, state.color(), shapeForPlacement(), canPlace);
      collab.sendCursor(hit);
    },

    pick: (stateId) => {
      if (stateId === AIR) return;
      const key = world.stateTable[stateId];
      if (key === undefined) return;

      state.color.set(stateRgb(key));
      state.cls.set(stateClass(key));

      const shape = world.stateShapes[stateId] ?? 0;
      const familyIndex = shapeFamilyIndex(shape);
      state.family.set(familyIndex);

      // The eyedropper copies the exact orientation for oriented families.
      const family = SHAPE_FAMILIES[familyIndex];
      if (family.orientations.length > 1) {
        state.facing.set(shapeOrientationIndex(shape));
      }

      sound.play("pick");
    },
  };

  /** Undo/redo wrapped so collab peers receive the reverted cells too. */
  const runUndoOperation = (operation: (apply: ApplyFn) => boolean): void => {
    saves.release();
    const touched: number[] = [];
    let fxBudget = 24;

    const apply: ApplyFn = (x, y, z, stateId) => {
      const prevId = world.get(x, y, z);
      world.set(x, y, z, stateId);
      if (fxBudget > 0 && deps.spawnEditFx(x, y, z, prevId, stateId)) fxBudget--;
      if (collab.active()) touched.push(x, y, z, 0, stateId);
    };

    const changed = operation(apply);
    if (changed) sound.play("ui");
    if (changed && collab.active() && touched.length > 0) {
      collab.broadcastEdits(Int32Array.from(touched));
    }
  };

  const pushRecentColor = (rgb: number): void => {
    const next = [rgb, ...state.recents().filter((existing) => existing !== rgb)];
    state.recents.set(next.slice(0, 8));
  };

  return {
    lastHover: () => lastHoverHit,
    toolEnv,
    shapeForPlacement,
    runUndo: () => runUndoOperation((apply) => undo.undo(apply)),
    runRedo: () => runUndoOperation((apply) => undo.redo(apply)),
    pushRecentColor,
  };
};
