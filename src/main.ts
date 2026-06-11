/** Composition root: world + scheduler + renderer + tools + UI, wired together. */
import "./styles.css";
import { Frustum, Group, Matrix4 } from "three";
import {
  AIR,
  applyWorldDims,
  builtinClassTable,
  CHUNK_BITS,
  CHUNK_SIZE,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  stateClass,
  stateRgb,
  WORLD_CX,
  WORLD_CY,
  WORLD_CZ,
  WORLD_PRESETS,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
  type WorldSnapshot,
} from "./core/types";
import { VoxelWorld } from "./core/world";
import type { ToolEnv } from "./interact/api";
import { initInput } from "./interact/input";
import { createSessionFactory } from "./interact/session";
import { createTools } from "./interact/tools";
import { type ApplyFn, UndoStack } from "./interact/undo";
import { decodeSnapshot, encodeSnapshot } from "./io/codec";
import { exportGlbFile } from "./io/gltf";
import { peekAutosaveDims, SaveStore } from "./io/saves";
import { RemeshScheduler } from "./mesh/scheduler";
import { joinBuildRoom, type NetSession, type RemoteCell, randomRoomId } from "./net/room";
import { CameraRig } from "./render/camera";
import { ChunkRenderer } from "./render/chunks";
import { plasmaMaterialDef, registerBlockMaterial } from "./render/custom";
import { createEnvironment } from "./render/env";
import { Highlighter } from "./render/highlight";
import { createGlassMaterial, createOpaqueMaterial } from "./render/materials";
import { PostPipeline } from "./render/postfx";
import { createRenderCore, type SkyState } from "./render/renderer";
import { buildStarter } from "./starter";
import { type AppActions, createAppState } from "./state";
import { initUi } from "./ui/index";
import { pickWorldSize } from "./ui/size-picker";

const showFatal = (message: string): void => {
  const overlay = document.createElement("div");
  overlay.className = "fatal";
  overlay.textContent = message;
  document.body.appendChild(overlay);
};

const SIZE_STORAGE_KEY = "bb-world-size";
const RENDERER_STORAGE_KEY = "bb-renderer";

/**
 * Fix the world dimensions before anything world-sized is constructed:
 * autosave dims win (so saved worlds reopen as-is), then the remembered
 * preset, then a first-run picker.
 */
const resolveWorldDims = async (): Promise<void> => {
  const saved = await peekAutosaveDims();
  if (
    saved &&
    saved.sx % CHUNK_SIZE === 0 &&
    saved.sy % CHUNK_SIZE === 0 &&
    saved.sz % CHUNK_SIZE === 0
  ) {
    applyWorldDims(saved.sx >> CHUNK_BITS, saved.sy >> CHUNK_BITS, saved.sz >> CHUNK_BITS);
    return;
  }
  const stored = WORLD_PRESETS.find((p) => p.id === localStorage.getItem(SIZE_STORAGE_KEY));
  if (stored) {
    applyWorldDims(stored.cx, stored.cy, stored.cz);
    return;
  }
  const chosen = (await pickWorldSize("medium", false)) ?? WORLD_PRESETS[1];
  localStorage.setItem(SIZE_STORAGE_KEY, chosen.id);
  applyWorldDims(chosen.cx, chosen.cy, chosen.cz);
};

const boot = async (): Promise<void> => {
  const app = document.getElementById("app");
  if (!app) throw new Error("missing #app element");
  const canvas = document.createElement("canvas");
  app.appendChild(canvas);
  const uiRoot = document.createElement("div");
  app.appendChild(uiRoot);

  const state = createAppState();
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) state.hud.set(true);

  await resolveWorldDims();
  const worldOffsetX = WORLD_SX / 2;
  const worldOffsetZ = WORLD_SZ / 2;
  const world = new VoxelWorld();
  const undo = new UndoStack();

  const storedRenderer = localStorage.getItem(RENDERER_STORAGE_KEY);
  if (storedRenderer === "webgl" || storedRenderer === "webgpu") {
    state.renderer.set(storedRenderer);
  }
  const rendererAtBoot = state.renderer();
  const core = await createRenderCore(canvas, state.shadowRes(), rendererAtBoot);
  const { renderer, scene, lights } = core;

  const cameraRig = new CameraRig(canvas);
  const worldGroup = new Group();
  worldGroup.position.set(-worldOffsetX, 0, -worldOffsetZ);
  scene.add(worldGroup);

  const chunkRenderer = new ChunkRenderer([createOpaqueMaterial(), createGlassMaterial()]);
  const highlight = new Highlighter();
  worldGroup.add(chunkRenderer.group, highlight.group);
  const environment = createEnvironment(scene);

  const workerCount = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
  const scheduler = new RemeshScheduler(
    world,
    builtinClassTable(),
    (ci, geometry) => {
      chunkRenderer.apply(ci, geometry);
      lights.invalidate();
    },
    workerCount,
  );
  registerBlockMaterial(plasmaMaterialDef(), { chunks: chunkRenderer, scheduler, state });

  const saves = new SaveStore({
    snapshot: () => world.toSnapshot(),
    restore: (snapshot) => restoreSnapshot(snapshot),
  });

  /** Whole-world replacement used by saves, imports, and collab snapshots. */
  const restoreSnapshot = (snapshot: WorldSnapshot): void => {
    if (snapshot.sx !== WORLD_SX || snapshot.sy !== WORLD_SY || snapshot.sz !== WORLD_SZ) {
      // Different world size: stash it as the autosave and reboot into those dims.
      state.toast.set("World size differs — reloading");
      void saves.stashAutosave(snapshot).then(() => window.location.reload());
      return;
    }
    world.loadSnapshot(snapshot);
    undo.clear();
  };

  // ── collaboration (zero-host WebRTC room; edits broadcast as packed keys) ──
  let net: NetSession | null = null;
  const applyRemoteEdits = (cells: RemoteCell[]): void => {
    for (const cell of cells) {
      const stateId =
        cell.key === 0
          ? AIR
          : world.internState(stateClass(cell.key), stateRgb(cell.key), cell.shape);
      world.set(cell.x, cell.y, cell.z, stateId);
    }
  };
  const joinCollabRoom = (roomId: string): void => {
    if (net) return;
    net = joinBuildRoom(roomId, {
      applyRemoteEdits,
      snapshotBytes: () => encodeSnapshot(world.toSnapshot()),
      restoreSnapshot: (bytes) => restoreSnapshot(decodeSnapshot(bytes)),
      onPeers: (count) => state.peers.set(count),
    });
    state.peers.set(0);
  };
  const leaveCollabRoom = (): void => {
    if (!net) return;
    net.leave();
    net = null;
    state.peers.set(-1);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  world.onDirty = (ci) => {
    scheduler.markDirty(ci);
    saves.autosaveSoon();
  };

  /** Ramp placements face away from the camera; other shapes map 1:1 from the chip choice. */
  const shapeForPlacement = (): number => {
    const choice = state.shape();
    if (choice !== 3) return choice;
    const dx = cameraRig.controls.target.x - cameraRig.camera.position.x;
    const dz = cameraRig.controls.target.z - cameraRig.camera.position.z;
    if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? SHAPE_RAMP_PX : SHAPE_RAMP_NX;
    return dz >= 0 ? SHAPE_RAMP_PZ : SHAPE_RAMP_NZ;
  };

  const toolEnv: ToolEnv = {
    world,
    state: () => world.internState(state.cls(), state.color(), shapeForPlacement()),
    begin: createSessionFactory(world, undo, (cells) =>
      net?.broadcastEdits(cells, world.stateTable, world.stateShapes),
    ),
    ghosts: (cells, count) => highlight.setGhosts(cells, count ?? (cells ? cells.length / 3 : 0)),
    hover: (hit) => highlight.setHover(hit),
    pick: (stateId) => {
      if (stateId === AIR) return;
      const key = world.stateTable[stateId];
      if (key === undefined) return;
      state.color.set(stateRgb(key));
      state.cls.set(stateClass(key));
      const shape = world.stateShapes[stateId] ?? 0;
      state.shape.set(shape < 3 ? shape : 3);
    },
  };

  const contentBounds = () => world.contentBounds();

  const pushRecentColor = (rgb: number): void => {
    const next = [rgb, ...state.recents().filter((existing) => existing !== rgb)];
    state.recents.set(next.slice(0, 8));
  };

  /** Undo/redo wrapped so collab peers receive the reverted cells too. */
  const runUndoOperation = (operation: (apply: ApplyFn) => boolean): void => {
    const touched: number[] = [];
    const apply: ApplyFn = (x, y, z, stateId) => {
      world.set(x, y, z, stateId);
      if (net) touched.push(x, y, z, 0, stateId);
    };
    const changed = operation(apply);
    if (changed && net && touched.length > 0) {
      net.broadcastEdits(Int32Array.from(touched), world.stateTable, world.stateShapes);
    }
  };

  initInput({
    canvas,
    pickRay: (x, y) => cameraRig.pickRay(x, y),
    tools: createTools(),
    env: toolEnv,
    state,
    undo: () => runUndoOperation((apply) => undo.undo(apply)),
    redo: () => runUndoOperation((apply) => undo.redo(apply)),
    frame: () => cameraRig.frame(contentBounds()),
    usedColor: pushRecentColor,
  });

  const post = new PostPipeline(renderer, scene, cameraRig.camera);
  state.bloom.sub((enabled) => post.setBloom(enabled));
  state.grid.sub((visible) => environment.setGridVisible(visible));
  state.shadows.sub((enabled) => lights.setShadowsEnabled(enabled));
  state.shadowRes.sub((size) => lights.setShadowResolution(size));
  state.renderer.sub((preference) => {
    if (preference === rendererAtBoot) return;
    localStorage.setItem(RENDERER_STORAGE_KEY, preference);
    void saves.flush().finally(() => window.location.reload());
  });

  // ── sun / moon: follow the host clock unless frozen to manual ──
  let applyingClockSun = false;
  const applySky = (sky: SkyState): void => {
    lights.setCelestial(sky);
    environment.setSky(sky);
  };
  /** Stylized clock → sky mapping (not an ephemeris): noon peaks at 62°; the moon mirrors the solar arc at night. */
  const skyFromClock = (): SkyState => {
    const now = new Date();
    const dayFrac = (now.getHours() * 60 + now.getMinutes()) / 1440;
    const solarElevation = Math.sin((dayFrac - 0.25) * Math.PI * 2) * 62;
    const moon = solarElevation < 4;
    const bodyFrac = moon ? (dayFrac + 0.5) % 1 : dayFrac;
    const arc = Math.min(1, Math.max(0, (bodyFrac - 0.25) * 2));
    return {
      azimuthDeg: 90 + arc * 180,
      elevationDeg: Math.max(10, moon ? -solarElevation * 0.7 : solarElevation),
      moon,
      dayness: Math.min(1, Math.max(0, (solarElevation + 4) / 16)),
    };
  };
  const applyClockSky = (): void => {
    const sky = skyFromClock();
    applyingClockSun = true;
    state.sunAzimuth.set(Math.round(sky.azimuthDeg));
    state.sunElevation.set(Math.round(sky.elevationDeg));
    applyingClockSun = false;
    applySky(sky);
  };
  const applyManualSky = (): void =>
    applySky({
      azimuthDeg: state.sunAzimuth(),
      elevationDeg: state.sunElevation(),
      moon: false,
      dayness: Math.min(1, Math.max(0, (state.sunElevation() - 4) / 26)),
    });
  const onSunSliderInput = (): void => {
    if (applyingClockSun) return;
    if (state.sunMode() === "time") state.sunMode.set("manual");
    else applyManualSky();
  };
  applyingClockSun = true;
  state.sunAzimuth.sub(onSunSliderInput);
  state.sunElevation.sub(onSunSliderInput);
  applyingClockSun = false;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  state.sunMode.sub((mode) => {
    if (clockTimer !== undefined) clearInterval(clockTimer);
    clockTimer = undefined;
    if (mode === "time") {
      applyClockSky();
      clockTimer = setInterval(applyClockSky, 60_000);
    } else {
      applyManualSky();
    }
  });

  const download = (data: Blob, filename: string): void => {
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const actions: AppActions = {
    newWorld: () => {
      void (async () => {
        leaveCollabRoom();
        const current = WORLD_PRESETS.find(
          (p) => p.cx === WORLD_CX && p.cy === WORLD_CY && p.cz === WORLD_CZ,
        );
        const chosen = await pickWorldSize(current?.id ?? "medium", true);
        if (!chosen) return;
        localStorage.setItem(SIZE_STORAGE_KEY, chosen.id);
        await saves.clearAutosave();
        if (chosen.cx === WORLD_CX && chosen.cy === WORLD_CY && chosen.cz === WORLD_CZ) {
          world.clear();
          undo.clear();
          state.toast.set("New world");
        } else {
          window.location.reload();
        }
      })();
    },
    share: async () => {
      if (!net) {
        const roomId = randomRoomId();
        window.location.hash = `r=${roomId}`;
        joinCollabRoom(roomId);
      }
      await navigator.clipboard.writeText(window.location.href);
      state.toast.set("Invite link copied — building together");
    },
    save: async (name) => {
      await saves.saveAs(name);
      state.toast.set(`Saved "${name}"`);
    },
    listSaves: () => saves.list(),
    load: async (name) => {
      leaveCollabRoom();
      await saves.load(name);
      state.toast.set(`Loaded "${name}"`);
    },
    deleteSave: (name) => saves.remove(name),
    exportFile: () => saves.exportBbkFile(),
    importFile: async (file) => {
      leaveCollabRoom();
      await saves.importAnyFile(file);
      state.toast.set(`Imported ${file.name}`);
    },
    exportVox: () => saves.exportVoxFile(),
    exportGlb: () => exportGlbFile(chunkRenderer.buildExportGroup(-worldOffsetX, -worldOffsetZ)),
    screenshot: async () => {
      post.render();
      const { promise, resolve } = Promise.withResolvers<Blob | null>();
      canvas.toBlob(resolve, "image/png");
      const blob = await promise;
      if (!blob) throw new Error("screenshot capture failed");
      download(blob, `buildingblock-${Date.now()}.png`);
    },
    frameCamera: () => cameraRig.frame(contentBounds()),
  };
  initUi(uiRoot, state, actions);

  const roomFromHash = /^#r=([a-z0-9]{4,})$/.exec(window.location.hash)?.[1];
  if (!(await saves.loadAutosave()) && !roomFromHash) buildStarter(world);
  if (roomFromHash) joinCollabRoom(roomFromHash);
  cameraRig.frame(contentBounds());

  const fitViewport = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.dprCap()));
    renderer.setSize(app.clientWidth, app.clientHeight, false);
    cameraRig.resize(app.clientWidth, app.clientHeight);
  };
  new ResizeObserver(fitViewport).observe(app);
  state.dprCap.sub(fitViewport);

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

  /**
   * Frame pacing inside three's vsync-driven animation loop: render only when the
   * cap interval has elapsed (drift-corrected accumulator), skip otherwise. The HUD
   * reports rendered fps plus the worst gap between rendered frames — the stutter
   * signal: a steady 30 shows ~33ms worst, an unstable 60 shows spikes.
   */
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
      cameraRig.update();
      scheduler.flush(3);
      post.render();
      cpuMsAccum += performance.now() - tickStart;
      renderCount++;
      lastDrawCalls = renderer.info.render.drawCalls;
      lastTriangles = renderer.info.render.triangles;
    }

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

  const gpuDevice = (renderer.backend as { device?: { lost?: Promise<{ message?: string }> } })
    .device;
  void gpuDevice?.lost?.then((info) =>
    showFatal(`GPU device lost${info.message ? `: ${info.message}` : ""}. Reload the page.`),
  );

  (window as unknown as Record<string, unknown>).__bb = {
    world,
    scheduler,
    renderer,
    state,
    place: (x: number, y: number, z: number, rgb = 0xd94f3d, cls = 0) =>
      world.set(x, y, z, world.internState(cls, rgb)),
    voxels: () => world.voxelCount(),
    draws: () => renderer.info.render.drawCalls,
  };
};

boot().catch((error: unknown) => {
  console.error(error);
  showFatal(
    `buildingblock failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
});
