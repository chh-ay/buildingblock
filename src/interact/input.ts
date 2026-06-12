/**
 * Pointer + keyboard router. Owns DOM events and routes them to tools/hotkeys:
 * - mouse: LMB drives the active tool (Alt+LMB = eyedropper); RMB/MMB/wheel belong to OrbitControls.
 * - touch: a quick tap acts with the active tool; any drag is camera navigation.
 * - wheel during an active gesture is offered to the tool first (box height) and swallowed if used.
 */
import { raycastPlane, raycastVoxel } from "../core/raycast";
import { SHAPE_FAMILIES, WORLD_SY } from "../core/types";
import type { AppState, ToolId } from "../state";
import type { Ray, Tool, ToolEnv, ToolPointer } from "./api";

export interface InputDeps {
  canvas: HTMLCanvasElement;
  /** Client coords → ray in voxel space. */
  pickRay(clientX: number, clientY: number): Ray;
  tools: Record<ToolId, Tool>;
  env: ToolEnv;
  state: AppState;
  /** Undo/redo, provided by main (wraps the stack so collab peers see reverts too). */
  undo(): void;
  redo(): void;
  frame(): void;
  /** A gesture that paints with the current color committed (recents tracking). */
  usedColor(rgb: number): void;
}

const TOOL_KEYS: Record<string, ToolId> = {
  b: "place",
  e: "erase",
  p: "paint",
  x: "box",
  i: "pick",
};

const TAP_MS = 350;
const TAP_PX_SQ = 64;
const RAY_RANGE = 640;

export const initInput = (deps: InputDeps): void => {
  const { canvas, state, env } = deps;
  let gesture: Tool | null = null;
  let lastPlaneY = 8;
  let touchStart: { x: number; y: number; t: number; id: number } | null = null;
  let touchMoved = false;

  const pointerOf = (e: PointerEvent): ToolPointer => {
    const ray = deps.pickRay(e.clientX, e.clientY);
    const planeY = Math.max(0, state.buildPlane());

    const voxelHit = raycastVoxel(
      (x, y, z) => env.world.get(x, y, z),
      ray.ox,
      ray.oy,
      ray.oz,
      ray.dx,
      ray.dy,
      ray.dz,
      RAY_RANGE,
    );
    const planeHit = raycastPlane(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, planeY);

    // With an elevated work plane, the nearer surface wins — otherwise terrain
    // behind the plane would swallow mid-air placements.
    let hit = voxelHit ?? planeHit;
    if (voxelHit && planeHit && state.buildPlane() >= 0) {
      const dv = Math.hypot(
        voxelHit.x + 0.5 - ray.ox,
        voxelHit.y + 0.5 - ray.oy,
        voxelHit.z + 0.5 - ray.oz,
      );
      const dp = Math.hypot(
        planeHit.x + 0.5 - ray.ox,
        planeHit.y + 1 - ray.oy,
        planeHit.z + 0.5 - ray.oz,
      );
      if (dp < dv) hit = planeHit;
    }
    return { ray, hit };
  };

  const currentTool = (): Tool => deps.tools[state.tool()];

  const afterCommit = (): void => {
    const t = state.tool();
    if (t === "place" || t === "paint" || t === "box") deps.usedColor(state.color());
  };

  const cancelGesture = (): void => {
    if (!gesture) return;
    gesture.cancel(env);
    gesture = null;
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (state.replaying()) return; // camera stays free; tools stay off
    if (e.pointerType === "touch") {
      touchStart = touchStart
        ? null // second finger: camera gesture, never a tap
        : { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      touchMoved = false;
      return;
    }
    if (e.button !== 0 || gesture) return;
    canvas.setPointerCapture(e.pointerId);
    const tool = e.altKey ? deps.tools.pick : currentTool();
    gesture = tool;
    tool.down(pointerOf(e), env);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") {
      if (touchStart && e.pointerId === touchStart.id) {
        const dx = e.clientX - touchStart.x;
        const dy = e.clientY - touchStart.y;
        if (dx * dx + dy * dy > TAP_PX_SQ) touchMoved = true;
      }
      return;
    }
    if (state.replaying()) return;
    const p = pointerOf(e);
    if (gesture) gesture.move(p, env);
    else currentTool().hover(p, env);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") {
      if (
        touchStart &&
        !touchMoved &&
        e.pointerId === touchStart.id &&
        performance.now() - touchStart.t < TAP_MS
      ) {
        const p = pointerOf(e);
        const tool = currentTool();
        tool.down(p, env);
        tool.up(p, env);
        afterCommit();
      }
      touchStart = null;
      return;
    }
    if (e.button !== 0 || !gesture) return;
    gesture.up(pointerOf(e), env);
    gesture = null;
    afterCommit();
    // Re-pick after the edit landed so the hover preview tracks the new surface immediately.
    currentTool().hover(pointerOf(e), env);
  });

  canvas.addEventListener("pointercancel", () => {
    cancelGesture();
    touchStart = null;
  });

  canvas.addEventListener("pointerleave", () => {
    if (!gesture) env.hover(null);
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener(
    "wheel",
    (e) => {
      if (gesture?.wheel(e.deltaY, env)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, passive: false },
  );

  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    // During replay the journal is rebuilding the world; undo/tool/edit hotkeys must stay off.
    if (state.replaying()) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) deps.redo();
        else deps.undo();
      } else if (k === "y") {
        e.preventDefault();
        deps.redo();
      }
      return;
    }
    const tool = TOOL_KEYS[k];
    if (tool) {
      cancelGesture();
      state.tool.set(tool);
    } else if (k >= "1" && k <= "9" && k.length === 1) {
      const c = state.swatches()[Number(k) - 1];
      if (c !== undefined) state.color.set(c);
    } else if (k === "escape") {
      if (gesture) cancelGesture();
      else state.helpOpen.set(false);
    } else if (k === "f") {
      deps.frame();
    } else if (k === "r") {
      // Rotate an oriented family's facing: Auto → 0 → 1 → 2 → 3 → Auto.
      const family = SHAPE_FAMILIES[state.family()];
      if (family.orientations.length > 1) {
        const facing = state.facing();
        state.facing.set(facing >= family.orientations.length - 1 ? -1 : facing + 1);
      }
    } else if (k === "[" || k === "]") {
      // Work plane: nudge the mid-air build height; below 0 turns it off.
      const step = k === "]" ? 1 : -1;
      const current = state.buildPlane();
      const next = current < 0 ? (step > 0 ? 1 : -1) : current + step;

      if (next < 0) {
        state.buildPlane.set(-1);
        state.toast.set("Build height off — placing on the ground");
      } else {
        const clamped = Math.min(WORLD_SY - 1, next);
        state.buildPlane.set(clamped);
        state.toast.set(`Build height ${clamped}`);
      }
    } else if (k === "\\") {
      // Toggle the work plane, remembering the last height.
      const current = state.buildPlane();
      if (current >= 0) {
        lastPlaneY = current;
        state.buildPlane.set(-1);
        state.toast.set("Build height off — placing on the ground");
      } else {
        state.buildPlane.set(lastPlaneY);
        state.toast.set(`Build height ${lastPlaneY}`);
      }
    } else if (k === "g") {
      state.grid.set(!state.grid());
    } else if (k === "f3") {
      e.preventDefault();
      state.hud.set(!state.hud());
    } else if (k === "?") {
      state.helpOpen.set(!state.helpOpen());
    }
  });
};
