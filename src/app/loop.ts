/**
 * The vsync-driven render loop with a user-configurable fps cap, plus the
 * 500 ms HUD sampling window.
 *
 * Frame pacing: render only when the cap interval has elapsed (drift-corrected
 * accumulator), skip otherwise. The HUD reports rendered fps plus the worst gap
 * between rendered frames — the stutter signal: a steady 30 shows ~33 ms worst,
 * an unstable 60 shows spikes.
 */
import { Frustum, Matrix4 } from "three";
import type { VoxelWorld } from "../core/world";
import type { RemeshScheduler } from "../mesh/scheduler";
import type { CameraRig } from "../render/camera";
import type { ChunkRenderer } from "../render/chunks";
import type { VoxelFx } from "../render/particles";
import type { PostPipeline } from "../render/postfx";
import type { PresenceRenderer } from "../render/presence";
import type { RenderCore } from "../render/renderer";
import type { AppState } from "../state";
import type { Attract } from "./attract";
import type { ReplayController } from "./replay";

export interface LoopDeps {
  core: RenderCore;
  app: HTMLElement;
  state: AppState;
  world: VoxelWorld;
  cameraRig: CameraRig;
  scheduler: RemeshScheduler;
  chunkRenderer: ChunkRenderer;
  fx: VoxelFx;
  post: PostPipeline;
  presence: PresenceRenderer;
  attract: Attract;
  replay: ReplayController;
  worldOffsetX: number;
  worldOffsetZ: number;
}

/** Installs the animation loop; returns nothing — the loop runs for the page's lifetime. */
export const startRenderLoop = (deps: LoopDeps): void => {
  const { core, app, state, world, cameraRig, scheduler, chunkRenderer, fx, post, presence } = deps;
  const renderer = core.renderer;

  const frustum = new Frustum();
  const projectionView = new Matrix4();

  let renderCount = 0;
  let cpuMsAccum = 0;
  let wallMsAccum = 0;
  let worstGapMs = 0;
  let capAccumMs = 0;
  let lastTickAt = performance.now();
  let lastRenderAt = performance.now();
  let lastHudAt = performance.now();
  let lastDrawCalls = 0;
  let lastTriangles = 0;

  renderer.setAnimationLoop(() => {
    const tickStart = performance.now();
    const tickDelta = tickStart - lastTickAt;
    lastTickAt = tickStart;
    wallMsAccum += tickDelta;

    const intervalMs = 1000 / state.fpsCap();
    capAccumMs = Math.min(capAccumMs + tickDelta, intervalMs * 4);

    if (capAccumMs >= intervalMs) {
      capAccumMs -= intervalMs;
      const gap = tickStart - lastRenderAt;
      if (gap > worstGapMs) worstGapMs = gap;
      lastRenderAt = tickStart;

      deps.attract.step(tickStart);
      deps.replay.step(tickStart);
      cameraRig.update(Math.min(gap, 100) / 1000);
      scheduler.flush(deps.replay.active() ? 8 : 3);
      if (fx.active()) fx.update(Math.min(gap, 100) / 1000);
      post.render();
      presence.updateLabels(
        cameraRig.camera,
        deps.worldOffsetX,
        deps.worldOffsetZ,
        app.clientWidth,
        app.clientHeight,
      );

      cpuMsAccum += performance.now() - tickStart;
      renderCount++;
      lastDrawCalls = renderer.info.render.drawCalls;
      lastTriangles = renderer.info.render.triangles;
    }

    // ── HUD sampling window ───────────────────────────────────────────────────
    if (tickStart - lastHudAt >= 500 && renderCount > 0) {
      if (state.hud()) {
        projectionView.multiplyMatrices(
          cameraRig.camera.projectionMatrix,
          cameraRig.camera.matrixWorldInverse,
        );
        frustum.setFromProjectionMatrix(projectionView);
        const chunkCounts = chunkRenderer.counts(frustum);

        state.perf.set({
          fps: Math.round((renderCount * 1000) / Math.max(1, wallMsAccum)),
          frameMs: Math.round((cpuMsAccum / renderCount) * 100) / 100,
          worstFrameMs: Math.round(worstGapMs * 10) / 10,
          dpr: renderer.getPixelRatio(),
          drawCalls: lastDrawCalls,
          triangles: lastTriangles,
          chunksVisible: chunkCounts.visible,
          chunksTotal: chunkCounts.total,
          remeshMs: Math.round(scheduler.stats.lastMs * 100) / 100,
          remeshCount: scheduler.stats.count,
          queueDepth: scheduler.stats.queueDepth,
          voxels: world.voxelCount(),
          states: world.stateTable.length,
          backend: core.backend,
        });
      }

      renderCount = 0;
      cpuMsAccum = 0;
      wallMsAccum = 0;
      worstGapMs = 0;
      lastHudAt = tickStart;
    }
  });
};
