import type { AppState, PerfStats } from "../state";
import { el } from "./el";

/** Builds the top-left perf HUD; visible iff `state.hud`, updated from `state.perf`. */
export const buildHud = (state: AppState): HTMLElement => {
  const l0 = el("div");
  const l1 = el("div");
  const l2 = el("div");
  const l3 = el("div");
  const l4 = el("div");
  const l5 = el("div");
  const hud = el("div", { className: "panel hud hidden" }, l0, l1, l2, l3, l4, l5);
  const render = (p: PerfStats): void => {
    l0.textContent = `${p.fps.toFixed(0)} fps · cpu ${p.frameMs.toFixed(1)} ms · worst ${p.worstFrameMs.toFixed(1)} ms`;
    l1.textContent = `draws ${p.drawCalls} · tris ${p.triangles} · dpr ${p.dpr}`;
    l2.textContent = `chunks ${p.chunksVisible}/${p.chunksTotal}`;
    l3.textContent = `remesh ${p.remeshMs.toFixed(1)} ms ×${p.remeshCount} · queue ${p.queueDepth}`;
    l4.textContent = `voxels ${p.voxels} · states ${p.states}`;
    l5.textContent = p.backend;
  };
  state.hud.sub((visible) => {
    hud.classList.toggle("hidden", !visible);
    if (visible) render(state.perf());
  });
  state.perf.sub((p) => {
    if (state.hud()) render(p);
  });
  return hud;
};
