/** Composition root: constructs every subsystem and wires them together. */
import "./styles.css";
import { Group } from "three";
import { createAppActions } from "./app/actions";
import { createAttract } from "./app/attract";
import {
  AUTOSAVE_SEC_STORAGE_KEY,
  AUTOSAVE_STORAGE_KEY,
  RENDERER_STORAGE_KEY,
  resolveBootPlan,
  SIZE_STORAGE_KEY,
  SOUND_STORAGE_KEY,
  showFatal,
} from "./app/boot";
import { createCollab } from "./app/collab";
import { createEditFx, createEditing } from "./app/editing";
import { startRenderLoop } from "./app/loop";
import { createOrbitMath } from "./app/orbit";
import { createReplayController } from "./app/replay";
import { createSkyController } from "./app/sky";
import { EditJournal } from "./core/journal";
import {
  builtinClassTable,
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
import { initInput } from "./interact/input";
import { createTools } from "./interact/tools";
import { UndoStack } from "./interact/undo";
import { encodeSnapshot } from "./io/codec";
import { SaveStore } from "./io/saves";
import { RemeshScheduler } from "./mesh/scheduler";
import { CameraRig } from "./render/camera";
import { ChunkRenderer } from "./render/chunks";
import {
  metalMaterialDef,
  plasmaMaterialDef,
  registerBlockMaterial,
  waterMaterialDef,
} from "./render/custom";
import { createEnvironment } from "./render/env";
import { Highlighter } from "./render/highlight";
import { createGlassMaterial, createOpaqueMaterial } from "./render/materials";
import { createVoxelFx } from "./render/particles";
import { PostPipeline } from "./render/postfx";
import { PresenceRenderer } from "./render/presence";
import { createRenderCore } from "./render/renderer";
import { createSound } from "./sound";
import { buildStarter } from "./starter";
import { createAppState } from "./state";
import { confirmDialog } from "./ui/confirm";
import { initUi } from "./ui/index";
import { pickWorldSize } from "./ui/size-picker";

const boot = async (): Promise<void> => {
  // ── DOM scaffold ────────────────────────────────────────────────────────────
  const app = document.getElementById("app");
  if (!app) throw new Error("missing #app element");

  const canvas = document.createElement("canvas");
  app.appendChild(canvas);
  const presenceLayer = document.createElement("div");
  presenceLayer.className = "presence-layer";
  app.appendChild(presenceLayer);
  const uiRoot = document.createElement("div");
  app.appendChild(uiRoot);

  // ── core state ──────────────────────────────────────────────────────────────
  const state = createAppState();
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) state.hud.set(true);

  const plan = await resolveBootPlan();
  const worldOffsetX = WORLD_SX / 2;
  const worldOffsetZ = WORLD_SZ / 2;
  const world = new VoxelWorld();
  const undo = new UndoStack();

  const journal = new EditJournal();
  let journalTracking = true;
  world.onEdit = (x, y, z, stateId) => {
    if (!journalTracking) return;
    journal.record(x, y, z, world.stateTable[stateId] ?? 0, world.stateShapes[stateId] ?? 0);
  };

  const soundEnabledAtBoot = localStorage.getItem(SOUND_STORAGE_KEY) !== "0";
  state.sound.set(soundEnabledAtBoot);
  const sound = createSound(soundEnabledAtBoot);
  state.sound.sub((enabled) => {
    sound.setEnabled(enabled);
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "1" : "0");
  });

  // ── renderer ────────────────────────────────────────────────────────────────
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
  const presence = new PresenceRenderer(presenceLayer);
  worldGroup.add(chunkRenderer.group, highlight.group, presence.group);
  const fx = createVoxelFx();
  worldGroup.add(fx.object);
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
  // Custom material classes — append-only: registration order fixes class ids 4/5/6 in saves.
  registerBlockMaterial(plasmaMaterialDef(), { chunks: chunkRenderer, scheduler, state });
  registerBlockMaterial(metalMaterialDef(), { chunks: chunkRenderer, scheduler, state });
  registerBlockMaterial(waterMaterialDef(), { chunks: chunkRenderer, scheduler, state });

  // ── persistence ─────────────────────────────────────────────────────────────
  const saves = new SaveStore({
    snapshot: () => world.toSnapshot(),
    restore: (snapshot) => restoreSnapshot(snapshot, false),
    // Writes are >= 30 s apart by policy, so an unthrottled toast stays quiet.
    onAutosaved: () => state.toast.set("Autosaved"),
  });

  // Autosave policy: master switch + debounce delay, persisted like sound.
  const storedAutosaveSec = Number(localStorage.getItem(AUTOSAVE_SEC_STORAGE_KEY));
  if (Number.isFinite(storedAutosaveSec) && storedAutosaveSec >= 30) {
    state.autosaveSec.set(storedAutosaveSec);
  }
  state.autosave.set(localStorage.getItem(AUTOSAVE_STORAGE_KEY) !== "0");
  const applyAutosavePolicy = (): void => {
    saves.setAutosavePolicy(state.autosave(), state.autosaveSec() * 1000);
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, state.autosave() ? "1" : "0");
    localStorage.setItem(AUTOSAVE_SEC_STORAGE_KEY, String(state.autosaveSec()));
  };
  state.autosave.sub(applyAutosavePolicy);
  state.autosaveSec.sub(applyAutosavePolicy);
  applyAutosavePolicy();

  /**
   * Whole-world replacement used by saves, imports, gallery, and collab snapshots.
   * Returns false when the dims differ and the page is rebooting into them.
   */
  const restoreSnapshot = (snapshot: WorldSnapshot, borrowed: boolean): boolean => {
    if (snapshot.sx !== WORLD_SX || snapshot.sy !== WORLD_SY || snapshot.sz !== WORLD_SZ) {
      // Different world size: park it in the pending slot (autosave intact) and reboot into its dims.
      state.toast.set("World size differs — reloading");
      void saves
        .flush()
        .then(() => saves.stashPending(snapshot))
        .then(() => window.location.reload());
      return false;
    }

    if (borrowed) saves.hold();
    world.loadSnapshot(snapshot);
    undo.clear();
    journal.reset(encodeSnapshot(snapshot));
    return true;
  };

  // ── app modules ─────────────────────────────────────────────────────────────
  const spawnEditFx = createEditFx(world, fx);
  const collab = createCollab({ world, state, presence, sound, spawnEditFx, restoreSnapshot });
  const orbit = createOrbitMath({ cameraRig, world, worldOffsetX, worldOffsetZ });
  const sky = createSkyController(state, {
    setCelestial: (s) => lights.setCelestial(s),
    setSky: (s) => environment.setSky(s),
  });
  const replay = createReplayController({
    world,
    journal,
    undo,
    saves,
    state,
    sound,
    fx,
    cameraRig,
    orbit,
    collabActive: collab.active,
    setJournalTracking: (on) => {
      journalTracking = on;
    },
  });
  const attract = createAttract(cameraRig, orbit, sky);
  const editing = createEditing({
    world,
    undo,
    state,
    sound,
    saves,
    highlight,
    cameraRig,
    collab,
    spawnEditFx,
  });

  world.onDirty = (ci) => {
    scheduler.markDirty(ci);
    saves.autosaveSoon();
  };

  initInput({
    canvas,
    pickRay: (x, y) => cameraRig.pickRay(x, y),
    tools: createTools(),
    env: editing.toolEnv,
    state,
    undo: editing.runUndo,
    redo: editing.runRedo,
    frame: () => {
      // F focuses the hovered block; with nothing under the pointer it frames the build.
      const hit = editing.lastHover();
      if (hit && !hit.ground) cameraRig.focusOn(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      else cameraRig.frame(world.contentBounds());
    },
    usedColor: editing.pushRecentColor,
  });

  // ── render pipeline wiring ──────────────────────────────────────────────────
  const post = new PostPipeline(renderer, scene, cameraRig.camera);
  state.bloom.sub((enabled) => post.setBloom(enabled));
  state.grid.sub((visible) => environment.setGridVisible(visible));
  state.buildPlane.sub((y) => environment.setBuildPlane(y));
  state.shadows.sub((enabled) => lights.setShadowsEnabled(enabled));
  state.shadowRes.sub((size) => lights.setShadowResolution(size));
  state.renderer.sub((preference) => {
    if (preference === rendererAtBoot) return;
    localStorage.setItem(RENDERER_STORAGE_KEY, preference);
    void saves.flush().finally(() => window.location.reload());
  });

  // ── actions + UI ────────────────────────────────────────────────────────────
  const actions = createAppActions({
    state,
    world,
    undo,
    saves,
    collab,
    replay,
    sound,
    cameraRig,
    orbit,
    chunkRenderer,
    canvas,
    worldOffsetX,
    worldOffsetZ,
    present: () => post.render(),
    restoreSnapshot,
  });
  initUi(uiRoot, state, actions);

  // ── boot flow: shared build / pending world / autosave / starter ────────────
  if (plan.sharedBuild) {
    // Dims were applied pre-construction; load directly and keep it borrowed until edited.
    saves.hold();
    world.loadSnapshot(plan.sharedBuild);
    undo.clear();
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    state.toast.set("Shared build loaded — it's yours to remix");

    replay.stageShowcase(plan.sharedBuild);
    void confirmDialog({
      title: "Watch this build come together?",
      body: "Someone shared a world with you. Replay its construction, or jump straight in.",
      yes: "Watch the build",
      no: "Jump in",
    }).then((watch) => {
      if (watch && !replay.active()) replay.begin(true);
    });
  } else if (plan.pendingWorld && (await saves.loadPending())) {
    state.toast.set("Loaded — remix away");

    if (!plan.roomId) {
      replay.stageShowcase(world.toSnapshot());
      void confirmDialog({
        title: "Watch it come together?",
        body: "Replay this scene's construction — scrub, pause, or skip anytime.",
        yes: "Watch the build",
        no: "Just explore",
      }).then((watch) => {
        if (watch && !replay.active()) replay.begin(true);
      });
    }
  } else if (!(await saves.loadAutosave()) && !plan.roomId) {
    buildStarter(world);
    journal.reset(encodeSnapshot(world.toSnapshot()));
  }

  if (plan.roomId) collab.join(plan.roomId, { creator: false });
  if (!replay.active()) orbit.frameHero();

  // ── attract mode (first run): pick a size over the live diorama ─────────────
  if (plan.attract) {
    attract.start();
    saves.hold();
    uiRoot.style.display = "none";

    void pickWorldSize("medium", false, true).then((preset) => {
      const chosen = preset ?? WORLD_PRESETS[1];
      localStorage.setItem(SIZE_STORAGE_KEY, chosen.id);
      attract.stop();
      uiRoot.style.display = "";

      if (chosen.cx !== WORLD_CX || chosen.cy !== WORLD_CY || chosen.cz !== WORLD_CZ) {
        window.location.reload();
        return;
      }

      sky.applyClockSky();
      orbit.frameHero();
      sound.play("ui");
    });
  }

  // ── viewport + loop ─────────────────────────────────────────────────────────
  const fitViewport = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.dprCap()));
    renderer.setSize(app.clientWidth, app.clientHeight, false);
    cameraRig.resize(app.clientWidth, app.clientHeight);
  };
  new ResizeObserver(fitViewport).observe(app);
  state.dprCap.sub(fitViewport);

  startRenderLoop({
    core,
    app,
    state,
    world,
    cameraRig,
    scheduler,
    chunkRenderer,
    fx,
    post,
    presence,
    attract,
    replay,
    worldOffsetX,
    worldOffsetZ,
  });

  const gpuDevice = (renderer.backend as { device?: { lost?: Promise<{ message?: string }> } })
    .device;
  void gpuDevice?.lost?.then((info) =>
    showFatal(`GPU device lost${info.message ? `: ${info.message}` : ""}. Reload the page.`),
  );

  // Debug handle for tests and tinkering.
  (window as unknown as Record<string, unknown>).__bb = {
    world,
    scheduler,
    renderer,
    state,
    place: (x: number, y: number, z: number, rgb = 0xd94f3d, cls = 0) =>
      world.set(x, y, z, world.internState(cls, rgb)),
    voxels: () => world.voxelCount(),
    draws: () => renderer.info.render.drawCalls,
    journal,
    replay: () => replay.begin(),
    rig: cameraRig,
    attractOn: attract.active,
    present: () => post.render(),
  };
};

boot().catch((error: unknown) => {
  console.error(error);
  showFatal(
    `buildingblock failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
});
