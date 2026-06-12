/** Composition root: world + scheduler + renderer + tools + UI, wired together. */
import "./styles.css";
import { Frustum, Group, Matrix4, Vector3 } from "three";
import { EditJournal, type JournalEntry, replayDurationMs, replayedCountAt } from "./core/journal";
import {
  AIR,
  applyWorldDims,
  builtinClassTable,
  CHUNK_BITS,
  CHUNK_SIZE,
  inWorld,
  type RayHit,
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
import { adjacentCell, createTools } from "./interact/tools";
import { type ApplyFn, UndoStack } from "./interact/undo";
import { decodeSnapshot, encodeSnapshot } from "./io/codec";
import { exportGlbFile } from "./io/gltf";
import { peekBootWorld, SaveStore } from "./io/saves";
import { buildShareUrl, fromBase64Url, parseAppHash } from "./io/share";
import { RemeshScheduler } from "./mesh/scheduler";
import { derivePeerIdentity } from "./net/identity";
import { joinBuildRoom, type NetSession, type RemoteCell, randomRoomId } from "./net/room";
import { CameraRig } from "./render/camera";
import { ChunkRenderer } from "./render/chunks";
import { plasmaMaterialDef, registerBlockMaterial } from "./render/custom";
import { createEnvironment } from "./render/env";
import { Highlighter } from "./render/highlight";
import { createGlassMaterial, createOpaqueMaterial } from "./render/materials";
import { createVoxelFx } from "./render/particles";
import { PostPipeline } from "./render/postfx";
import { PresenceRenderer } from "./render/presence";
import { createRenderCore, type SkyState } from "./render/renderer";
import { createSound } from "./sound";
import { buildStarter } from "./starter";
import { type AppActions, createAppState, type ToolId } from "./state";
import { confirmDialog } from "./ui/confirm";
import { openGallery as openGalleryModal } from "./ui/gallery";
import { initUi } from "./ui/index";
import { pickWorldSize } from "./ui/size-picker";
import { createReplayTransport, type ReplayTransport } from "./ui/transport";

const showFatal = (message: string): void => {
  const overlay = document.createElement("div");
  overlay.className = "fatal";
  overlay.textContent = message;
  document.body.appendChild(overlay);
};

const SIZE_STORAGE_KEY = "bb-world-size";
const RENDERER_STORAGE_KEY = "bb-renderer";
const SOUND_STORAGE_KEY = "bb-sound";

interface BootPlan {
  /** First run: the world boots behind an attract-mode size picker. */
  attract: boolean;
  /** A parked world (gallery/share dim change) waits in the pending slot. */
  pendingWorld: boolean;
  /** Decoded #b= snapshot; dims already applied. */
  sharedBuild: WorldSnapshot | null;
  roomId: string | null;
}

/**
 * Fix the world dimensions before anything world-sized is constructed:
 * a #b= share link wins (its snapshot carries dims), then a parked pending
 * world, then the autosave, then the remembered preset. True first runs boot
 * a medium world immediately and pick the size over a live attract scene.
 */
const resolveBootPlan = async (): Promise<BootPlan> => {
  const hash = parseAppHash(window.location.hash);
  if (!hash.room && hash.build) {
    try {
      let bytes = fromBase64Url(hash.build) as Uint8Array<ArrayBuffer>;
      if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(
          await new Response(
            new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
          ).arrayBuffer(),
        );
      }
      const snapshot = decodeSnapshot(bytes);
      applyWorldDims(
        snapshot.sx >> CHUNK_BITS,
        snapshot.sy >> CHUNK_BITS,
        snapshot.sz >> CHUNK_BITS,
      );
      return { attract: false, pendingWorld: false, sharedBuild: snapshot, roomId: null };
    } catch (error) {
      console.warn("share link unreadable", error);
    }
  }
  const roomId = hash.room;
  const saved = await peekBootWorld();
  if (
    saved &&
    saved.sx % CHUNK_SIZE === 0 &&
    saved.sy % CHUNK_SIZE === 0 &&
    saved.sz % CHUNK_SIZE === 0
  ) {
    applyWorldDims(saved.sx >> CHUNK_BITS, saved.sy >> CHUNK_BITS, saved.sz >> CHUNK_BITS);
    return { attract: false, pendingWorld: saved.pending, sharedBuild: null, roomId };
  }
  const stored = WORLD_PRESETS.find((p) => p.id === localStorage.getItem(SIZE_STORAGE_KEY));
  if (stored) {
    applyWorldDims(stored.cx, stored.cy, stored.cz);
    return { attract: false, pendingWorld: false, sharedBuild: null, roomId };
  }
  const preset = WORLD_PRESETS[1];
  applyWorldDims(preset.cx, preset.cy, preset.cz);
  // Room links skip the picker (the room's world decides); everyone else gets attract mode.
  return { attract: roomId === null, pendingWorld: false, sharedBuild: null, roomId };
};

const boot = async (): Promise<void> => {
  const app = document.getElementById("app");
  if (!app) throw new Error("missing #app element");
  const canvas = document.createElement("canvas");
  app.appendChild(canvas);
  const presenceLayer = document.createElement("div");
  presenceLayer.className = "presence-layer";
  app.appendChild(presenceLayer);
  const uiRoot = document.createElement("div");
  app.appendChild(uiRoot);

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
  registerBlockMaterial(plasmaMaterialDef(), { chunks: chunkRenderer, scheduler, state });

  const saves = new SaveStore({
    snapshot: () => world.toSnapshot(),
    restore: (snapshot) => restoreSnapshot(snapshot),
  });

  /**
   * Whole-world replacement used by saves, imports, gallery, and collab snapshots.
   * Returns false when the dims differ and the page is rebooting into them.
   */
  const restoreSnapshot = (snapshot: WorldSnapshot, borrowed = false): boolean => {
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

  // ── collaboration (zero-host WebRTC room; edits broadcast as packed keys) ──
  let net: NetSession | null = null;
  /** Confetti on destruction, snap flash on creation/paint. Returns true when something spawned. */
  const spawnEditFx = (
    x: number,
    y: number,
    z: number,
    prevId: number,
    nextId: number,
  ): boolean => {
    if (nextId === AIR) {
      if (prevId === AIR) return false;
      fx.burst(x, y, z, stateRgb(world.stateTable[prevId] ?? 0));
      return true;
    }
    fx.flash(x, y, z, stateRgb(world.stateTable[nextId] ?? 0));
    return true;
  };

  const applyRemoteEdits = (cells: RemoteCell[]): void => {
    let fxBudget = 24;
    for (const cell of cells) {
      const stateId =
        cell.key === 0
          ? AIR
          : world.internState(stateClass(cell.key), stateRgb(cell.key), cell.shape);
      const prevId = world.get(cell.x, cell.y, cell.z);
      if (!world.set(cell.x, cell.y, cell.z, stateId)) continue;
      if (fxBudget > 0 && spawnEditFx(cell.x, cell.y, cell.z, prevId, stateId)) fxBudget--;
    }
  };
  /** Roster → identities, markers, pill badges, and tab-title presence. */
  const syncRoster = (peerIds: readonly string[]): void => {
    state.peers.set(net ? peerIds.length : -1);
    const badges = peerIds.map((id) => {
      const identity = derivePeerIdentity(id);
      presence.upsertPeer(id, identity.name, identity.cssColor, identity.hexColor);
      return { id, name: identity.name, color: identity.cssColor };
    });
    presence.pruneTo(peerIds);
    state.roster.set(badges);
    document.title =
      peerIds.length > 0 ? `buildingblock — ${peerIds.length + 1} building` : "buildingblock";
  };
  const joinCollabRoom = (roomId: string): void => {
    if (net) return;
    net = joinBuildRoom(roomId, {
      applyRemoteEdits,
      snapshotBytes: () => encodeSnapshot(world.toSnapshot()),
      restoreSnapshot: (bytes) => restoreSnapshot(decodeSnapshot(bytes), true),
      onRoster: syncRoster,
      onPeerCursor: (peerId, cursor) => presence.setCursor(peerId, cursor),
    });
    state.peers.set(0);
  };
  const leaveCollabRoom = (): void => {
    if (!net) return;
    net.leave();
    net = null;
    presence.clear();
    state.roster.set([]);
    state.peers.set(-1);
    document.title = "buildingblock";
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  // Hover presence: throttled cursor broadcasts (12-byte records), trailing hide on null.
  const TOOL_WIRE_IDS: Record<ToolId, number> = { place: 0, erase: 1, paint: 2, box: 3, pick: 4 };
  let lastCursorSentAt = 0;
  let cursorVisibleRemotely = false;
  const sendPresenceCursor = (hit: RayHit | null): void => {
    if (!net) return;
    if (hit === null) {
      if (cursorVisibleRemotely) {
        net.sendCursor(null);
        cursorVisibleRemotely = false;
      }
      return;
    }
    const now = performance.now();
    if (now - lastCursorSentAt < 80) return;
    lastCursorSentAt = now;
    cursorVisibleRemotely = true;
    net.sendCursor({
      x: hit.x,
      y: hit.ground ? 0 : hit.y,
      z: hit.z,
      face: hit.face,
      tool: TOOL_WIRE_IDS[state.tool()],
      color: state.color(),
    });
  };
  world.onDirty = (ci) => {
    scheduler.markDirty(ci);
    saves.autosaveSoon();
  };

  /** Ramp orientation: explicit facing when chosen, else away from the camera. */
  const shapeForPlacement = (): number => {
    const choice = state.shape();
    if (choice !== 3) return choice;
    const facing = state.rampFacing();
    if (facing >= SHAPE_RAMP_PX) return facing;
    const dx = cameraRig.controls.target.x - cameraRig.camera.position.x;
    const dz = cameraRig.controls.target.z - cameraRig.camera.position.z;
    if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? SHAPE_RAMP_PX : SHAPE_RAMP_NX;
    return dz >= 0 ? SHAPE_RAMP_PZ : SHAPE_RAMP_NZ;
  };

  const sessionFactory = createSessionFactory(world, undo, (cells) =>
    net?.broadcastEdits(cells, world.stateTable, world.stateShapes),
  );
  let lastEditSoundAt = 0;
  const toolEnv: ToolEnv = {
    world,
    state: () => world.internState(state.cls(), state.color(), shapeForPlacement()),
    /** Sessions wrapped for juice: throttled edit sounds, particles, autosave release. */
    begin: () => {
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
          if (fxBudget > 0 && spawnEditFx(x, y, z, prevId, stateId)) fxBudget--;
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
    },
    ghosts: (cells, count) =>
      highlight.setGhosts(
        cells,
        count ?? (cells ? cells.length / 3 : 0),
        state.tool() === "erase" ? 0xe0524d : state.color(),
      ),
    hover: (hit) => {
      const tool = state.tool();
      let canPlace = false;
      if (hit && (tool === "place" || tool === "box")) {
        const [ax, ay, az] = adjacentCell(hit);
        canPlace = inWorld(ax, ay, az) && world.get(ax, ay, az) === AIR;
      }
      highlight.setHover(hit, tool, state.color(), shapeForPlacement(), canPlace);
      sendPresenceCursor(hit);
    },
    pick: (stateId) => {
      if (stateId === AIR) return;
      const key = world.stateTable[stateId];
      if (key === undefined) return;
      state.color.set(stateRgb(key));
      state.cls.set(stateClass(key));
      const shape = world.stateShapes[stateId] ?? 0;
      state.shape.set(shape < 3 ? shape : 3);
      if (shape >= 3) state.rampFacing.set(shape); // eyedropper copies the exact orientation
      sound.play("pick");
    },
  };

  const contentBounds = () => world.contentBounds();

  const pushRecentColor = (rgb: number): void => {
    const next = [rgb, ...state.recents().filter((existing) => existing !== rgb)];
    state.recents.set(next.slice(0, 8));
  };

  /** Undo/redo wrapped so collab peers receive the reverted cells too. */
  const runUndoOperation = (operation: (apply: ApplyFn) => boolean): void => {
    saves.release();
    const touched: number[] = [];
    let fxBudget = 24;
    const apply: ApplyFn = (x, y, z, stateId) => {
      const prevId = world.get(x, y, z);
      world.set(x, y, z, stateId);
      if (fxBudget > 0 && spawnEditFx(x, y, z, prevId, stateId)) fxBudget--;
      if (net) touched.push(x, y, z, 0, stateId);
    };
    const changed = operation(apply);
    if (changed) sound.play("ui");
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
  /** Stylized day-fraction → sky mapping (not an ephemeris): noon peaks at 62°; the moon mirrors the solar arc at night. */
  const skyAtDayFrac = (dayFrac: number): SkyState => {
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
  const skyFromClock = (): SkyState => {
    const now = new Date();
    return skyAtDayFrac((now.getHours() * 60 + now.getMinutes()) / 1440);
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

  // ── build replay: rebuild from the journal under an orbiting camera ──
  const scratchOrbitPos = new Vector3();
  const scratchOrbitTarget = new Vector3();
  /**
   * Camera position on an orbit that frames a bounding sphere of `radius` with
   * the same fov-derived margin CameraRig.frame uses — the whole build stays in
   * shot for the entire revolution.
   */
  const orbitPoint = (
    center: { x: number; y: number; z: number },
    radius: number,
    angle: number,
    out: Vector3,
  ): Vector3 => {
    const halfFov = (cameraRig.camera.fov * Math.PI) / 360;
    const distance = Math.max(18, (radius / Math.tan(halfFov)) * 1.12);
    const elevation = 0.58; // ~33° above the horizon
    const horizontal = distance * Math.cos(elevation);
    out.set(
      center.x + Math.cos(angle) * horizontal,
      center.y + distance * Math.sin(elevation),
      center.z + Math.sin(angle) * horizontal,
    );
    return out;
  };

  /** Scene-space orbit pivot + radius for the current build (offset-corrected). */
  const orbitFrame = (): { center: { x: number; y: number; z: number }; radius: number } => {
    const bounds = world.contentBounds();
    if (!bounds) {
      return { center: { x: 0, y: 6, z: 0 }, radius: Math.max(WORLD_SX, WORLD_SZ) * 0.4 };
    }
    const { min, max } = bounds;
    return {
      center: {
        x: (min[0] + max[0]) / 2 - worldOffsetX,
        y: (min[1] + max[1]) / 2,
        z: (min[2] + max[2]) / 2 - worldOffsetZ,
      },
      radius: Math.max(8, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2),
    };
  };

  /** Deterministic hero shot: frame the build from a fixed pleasant azimuth (boot, loads). */
  const frameHero = (): void => {
    const { center, radius } = orbitFrame();
    orbitPoint(center, radius, -0.65, scratchOrbitPos);
    cameraRig.controls.target.set(center.x, center.y, center.z);
    cameraRig.camera.position.copy(scratchOrbitPos);
    cameraRig.camera.lookAt(cameraRig.controls.target);
  };

  const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
  interface ReplayRun {
    startedAt: number;
    durationMs: number;
    /** Timeline position in ms; advanced by dt × speed while playing, set directly by seeks. */
    progressMs: number;
    lastNow: number;
    playing: boolean;
    speed: number;
    /** Scrub target (0..1) waiting to be applied; at most one seek lands per frame. */
    pendingSeek: number | null;
    applied: number;
    total: number;
    statesBefore: number;
    angle0: number;
    center: { x: number; y: number; z: number };
    radius: number;
    /** Decoded once so backward seeks can rebuild without re-parsing the baseline. */
    baselineSnapshot: WorldSnapshot | null;
    lastTickSoundAt: number;
    savedCameraPos: Vector3;
    /** Camera pose the orbit eases away from; refreshed on every resume. */
    blendPos: Vector3;
    blendTarget: Vector3;
    blendFrom: number;
    savedTarget: Vector3;
    blocker: HTMLDivElement;
    transport: ReplayTransport;
    homeAfter: boolean;
  }
  let replayRun: ReplayRun | null = null;
  const journalScratch: JournalEntry = { x: 0, y: 0, z: 0, key32: 0, shape: 0 };

  const applyJournalRange = (from: number, to: number, flashes: boolean): void => {
    for (let i = from; i < to; i++) {
      const entry = journal.entryAt(i, journalScratch);
      const stateId =
        entry.key32 === 0
          ? AIR
          : world.internState(stateClass(entry.key32), stateRgb(entry.key32), entry.shape);
      world.set(entry.x, entry.y, entry.z, stateId);
      if (flashes && stateId !== AIR && i % 12 === 0) {
        fx.flash(entry.x, entry.y, entry.z, stateRgb(entry.key32));
      }
    }
  };

  const finishReplay = (skipped: boolean): void => {
    if (!replayRun) return;
    const wasShowcase = replayRun.homeAfter;
    applyJournalRange(replayRun.applied, replayRun.total, false);
    journalTracking = true;
    // Intern order is deterministic, so ids only diverge when states were interned but never
    // written (preview-only); then the undo stack's ids are unsafe and it resets.
    if (world.stateCount !== replayRun.statesBefore) undo.clear();
    if (replayRun.homeAfter) {
      frameHero();
    } else {
      cameraRig.camera.position.copy(replayRun.savedCameraPos);
      cameraRig.controls.target.copy(replayRun.savedTarget);
    }
    replayRun.blocker.remove();
    replayRun.transport.dispose();
    replayRun = null;
    state.replaying.set(false);
    saves.release();
    saves.autosaveSoon();
    state.toast.set(
      skipped
        ? "Skipped — it's all yours"
        : wasShowcase
          ? "Built. Now remix it"
          : "That's how it was built",
    );
  };

  const beginReplay = (homeAfter = false): void => {
    if (replayRun) return;
    if (net) {
      state.toast.set("Replay is solo — leave the room first");
      return;
    }
    if (journal.overflowed) {
      state.toast.set("This session is too long to replay");
      return;
    }
    if (journal.length < 8) {
      state.toast.set("Build something first — replay shows your session");
      return;
    }
    const { center, radius } = orbitFrame();
    const blocker = document.createElement("div");
    blocker.className = "input-blocker";
    document.body.append(blocker);
    const transport = createReplayTransport({
      onTogglePlay: () => {
        if (!replayRun) return;
        replayRun.playing = !replayRun.playing;
        replayRun.transport.setPlaying(replayRun.playing);
        // Paused: free the camera (tools stay gated by state.replaying); playing: cinematic lock.
        replayRun.blocker.style.display = replayRun.playing ? "" : "none";
        if (replayRun.playing) {
          // Resume eases from wherever the player parked the camera while paused.
          replayRun.blendPos.copy(cameraRig.camera.position);
          replayRun.blendTarget.copy(cameraRig.controls.target);
          replayRun.blendFrom = performance.now();
        }
      },
      onSeek: (frac) => {
        if (replayRun) replayRun.pendingSeek = frac;
      },
      onCycleSpeed: () => {
        if (!replayRun) return;
        const at = REPLAY_SPEEDS.indexOf(replayRun.speed as (typeof REPLAY_SPEEDS)[number]);
        replayRun.speed = REPLAY_SPEEDS[(at + 1) % REPLAY_SPEEDS.length];
        replayRun.transport.setSpeed(replayRun.speed);
      },
      onSkip: () => finishReplay(true),
    });

    replayRun = {
      startedAt: performance.now(),
      durationMs: replayDurationMs(journal.length),
      progressMs: 0,
      lastNow: performance.now(),
      playing: true,
      speed: 1,
      pendingSeek: null,
      applied: 0,
      total: journal.length,
      statesBefore: world.stateCount,
      angle0: Math.atan2(
        cameraRig.camera.position.z - center.z,
        cameraRig.camera.position.x - center.x,
      ),
      center,
      radius,
      baselineSnapshot: journal.baseline ? decodeSnapshot(journal.baseline) : null,
      lastTickSoundAt: 0,
      savedCameraPos: cameraRig.camera.position.clone(),
      savedTarget: cameraRig.controls.target.clone(),
      blendPos: cameraRig.camera.position.clone(),
      blendTarget: cameraRig.controls.target.clone(),
      blendFrom: performance.now(),
      blocker,
      transport,
      homeAfter,
    };
    state.replaying.set(true);
    journalTracking = false;
    saves.hold();
    sound.play("ui");
    if (replayRun.baselineSnapshot) world.loadSnapshot(replayRun.baselineSnapshot);
    else world.clear();
  };

  /** Rebuild the journal as a synthetic bottom-up construction sequence (gallery / share showcases). */
  const stageShowcase = (snapshot: WorldSnapshot): void => {
    const cells: {
      x: number;
      y: number;
      z: number;
      key32: number;
      shape: number;
      order: number;
    }[] = [];
    let sumX = 0;
    let sumZ = 0;
    for (const chunk of snapshot.chunks) {
      const baseX = (chunk.ci % WORLD_CX) << CHUNK_BITS;
      const baseZ = (((chunk.ci / WORLD_CX) | 0) % WORLD_CZ) << CHUNK_BITS;
      const baseY = ((chunk.ci / (WORLD_CX * WORLD_CZ)) | 0) << CHUNK_BITS;
      const states = chunk.states;
      for (let i = 0; i < states.length; i++) {
        const stateId = states[i];
        if (stateId === AIR) continue;
        const x = baseX + (i & (CHUNK_SIZE - 1));
        const z = baseZ + ((i >> CHUNK_BITS) & (CHUNK_SIZE - 1));
        const y = baseY + (i >> (CHUNK_BITS << 1));
        cells.push({
          x,
          y,
          z,
          key32: snapshot.stateTable[stateId] ?? 0,
          shape: snapshot.stateShapes[stateId] ?? 0,
          order: 0,
        });
        sumX += x;
        sumZ += z;
      }
    }
    if (cells.length === 0) return;
    const centerX = sumX / cells.length;
    const centerZ = sumZ / cells.length;
    // Bottom-up, then radially outward: reads like a build crew working from the middle out.
    for (const cell of cells) {
      const dx = cell.x - centerX;
      const dz = cell.z - centerZ;
      cell.order = cell.y * 1_000_000 + dx * dx + dz * dz;
    }
    cells.sort((a, b) => a.order - b.order);
    journal.reset(null);
    for (const cell of cells) journal.record(cell.x, cell.y, cell.z, cell.key32, cell.shape);
  };

  const stepReplay = (now: number): void => {
    if (!replayRun) return;
    const run = replayRun;
    const dt = Math.min(100, now - run.lastNow);
    run.lastNow = now;

    if (run.pendingSeek !== null) {
      // Scrubbing: forward applies the delta, backward rebuilds from the baseline.
      run.progressMs = run.pendingSeek * run.durationMs;
      run.pendingSeek = null;
      const target = replayedCountAt(run.progressMs, run.durationMs, run.total);
      if (target >= run.applied) {
        applyJournalRange(run.applied, target, false);
      } else {
        if (run.baselineSnapshot) world.loadSnapshot(run.baselineSnapshot);
        else world.clear();
        applyJournalRange(0, target, false);
      }
      run.applied = target;
    } else if (run.playing) {
      run.progressMs = Math.min(run.durationMs, run.progressMs + dt * run.speed);
      const target = replayedCountAt(run.progressMs, run.durationMs, run.total);
      if (target > run.applied) {
        applyJournalRange(run.applied, target, true);
        run.applied = target;
        if (now - run.lastTickSoundAt >= 260 && target < run.total) {
          run.lastTickSoundAt = now;
          sound.play("tick", { pitch: target / run.total });
        }
      }
    }
    run.transport.setProgress(run.durationMs <= 0 ? 1 : run.progressMs / run.durationMs);

    // The orbit follows the timeline and only drives the camera while playing;
    // paused, the player is free to orbit and inspect the half-built world.
    if (run.playing) {
      orbitPoint(
        run.center,
        run.radius,
        run.angle0 + (run.progressMs / 1000) * 0.28,
        scratchOrbitPos,
      );
      scratchOrbitTarget.set(run.center.x, run.center.y, run.center.z);
      const blendT = Math.min(1, (now - run.blendFrom) / 900);
      const blend = blendT * blendT * (3 - 2 * blendT);
      cameraRig.camera.position.lerpVectors(run.blendPos, scratchOrbitPos, blend);
      cameraRig.controls.target.lerpVectors(run.blendTarget, scratchOrbitTarget, blend);
      cameraRig.camera.lookAt(cameraRig.controls.target);
    }
    if (run.playing && run.progressMs >= run.durationMs) finishReplay(false);
  };

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && replayRun) finishReplay(true);
  });

  // ── attract mode: first-run diorama spins under the size picker ──
  let attractActive = false;
  let attractSkyAppliedAt = 0;
  const stepAttract = (now: number): void => {
    const { center, radius } = orbitFrame();
    orbitPoint(center, radius, now * 0.00018, scratchOrbitPos);
    cameraRig.controls.target.set(center.x, center.y, center.z);
    cameraRig.camera.position.copy(scratchOrbitPos);
    cameraRig.camera.lookAt(cameraRig.controls.target);
    if (now - attractSkyAppliedAt >= 250) {
      attractSkyAppliedAt = now;
      // One stylized day every 150 seconds, starting at morning so the first minute stays bright.
      applySky(skyAtDayFrac((0.32 + now / 150_000) % 1));
    }
  };

  const download = (data: Blob, filename: string): void => {
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /** World-mutating actions wait for the replay to end (Skip is one tap away). */
  const busyReplaying = (): boolean => {
    if (!state.replaying()) return false;
    state.toast.set("Finish or skip the replay first");
    return true;
  };

  const actions: AppActions = {
    newWorld: () => {
      if (busyReplaying()) return;
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
      if (busyReplaying()) return;
      if (!net) {
        const roomId = randomRoomId();
        window.location.hash = `r=${roomId}`;
        joinCollabRoom(roomId);
      }
      await navigator.clipboard.writeText(window.location.href);
      state.toast.set("Invite link copied — building together");
    },
    save: async (name) => {
      if (busyReplaying()) return;
      await saves.saveAs(name);
      state.toast.set(`Saved "${name}"`);
    },
    listSaves: () => saves.list(),
    load: async (name) => {
      if (busyReplaying()) return;
      leaveCollabRoom();
      await saves.load(name);
      state.toast.set(`Loaded "${name}"`);
    },
    deleteSave: (name) => saves.remove(name),
    exportFile: () => saves.exportBbkFile(),
    importFile: async (file) => {
      if (busyReplaying()) return;
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
    shareBuildLink: async () => {
      if (busyReplaying()) return;
      const bytes = encodeSnapshot(world.toSnapshot());
      const gz = new Uint8Array(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
        ).arrayBuffer(),
      );
      const url = buildShareUrl(window.location.href, gz);
      if (url === null) {
        state.toast.set("Build too large for a link — Export → World instead");
        return;
      }
      await navigator.clipboard.writeText(url);
      state.toast.set("Build link copied — the whole world rides in the URL");
    },
    openGallery: async () => {
      if (busyReplaying()) return;
      const baseUrl =
        (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
      const pick = await openGalleryModal(baseUrl);
      if (!pick) return;
      leaveCollabRoom();
      sound.play("ui");
      const snapshot = decodeSnapshot(pick.data);
      if (!restoreSnapshot(snapshot, true)) return; // dim change: page reboots into the scene
      stageShowcase(snapshot);
      frameHero();
      state.toast.set(`"${pick.entry.name}" loaded`);
      const watch = await confirmDialog({
        title: `Watch "${pick.entry.name}" come together?`,
        body: "A short construction replay. Scrub, pause, change speed, or skip anytime.",
        yes: "Watch the build",
        no: "Just explore",
      });
      if (watch && !replayRun) beginReplay(true);
    },
    startReplay: () => beginReplay(),
  };
  initUi(uiRoot, state, actions);

  if (plan.sharedBuild) {
    // Dims were applied pre-construction; load directly and keep it borrowed until edited.
    saves.hold();
    world.loadSnapshot(plan.sharedBuild);
    undo.clear();
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    state.toast.set("Shared build loaded — it's yours to remix");
    stageShowcase(plan.sharedBuild);
    void confirmDialog({
      title: "Watch this build come together?",
      body: "Someone shared a world with you. Replay its construction, or jump straight in.",
      yes: "Watch the build",
      no: "Jump in",
    }).then((watch) => {
      if (watch && !replayRun) beginReplay(true);
    });
  } else if (plan.pendingWorld && (await saves.loadPending())) {
    state.toast.set("Loaded — remix away");
    if (!plan.roomId) {
      stageShowcase(world.toSnapshot());
      void confirmDialog({
        title: "Watch it come together?",
        body: "Replay this scene's construction — scrub, pause, or skip anytime.",
        yes: "Watch the build",
        no: "Just explore",
      }).then((watch) => {
        if (watch && !replayRun) beginReplay(true);
      });
    }
  } else if (!(await saves.loadAutosave()) && !plan.roomId) {
    buildStarter(world);
    journal.reset(encodeSnapshot(world.toSnapshot()));
  }
  if (plan.roomId) joinCollabRoom(plan.roomId);
  if (!replayRun) frameHero();

  if (plan.attract) {
    attractActive = true;
    saves.hold();
    uiRoot.style.display = "none";
    void pickWorldSize("medium", false, true).then((preset) => {
      const chosen = preset ?? WORLD_PRESETS[1];
      localStorage.setItem(SIZE_STORAGE_KEY, chosen.id);
      attractActive = false;
      uiRoot.style.display = "";
      if (chosen.cx !== WORLD_CX || chosen.cy !== WORLD_CY || chosen.cz !== WORLD_CZ) {
        window.location.reload();
        return;
      }
      applyClockSky();
      frameHero();
      sound.play("ui");
    });
  }

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
      if (attractActive) stepAttract(tickStart);
      if (replayRun) stepReplay(tickStart);
      cameraRig.update();
      scheduler.flush(replayRun ? 8 : 3);
      if (fx.active()) fx.update(Math.min(gap, 100) / 1000);
      post.render();
      presence.updateLabels(
        cameraRig.camera,
        worldOffsetX,
        worldOffsetZ,
        app.clientWidth,
        app.clientHeight,
      );
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
    journal,
    replay: () => beginReplay(),
    rig: cameraRig,
    attractOn: () => attractActive,
    present: () => post.render(),
  };
};

boot().catch((error: unknown) => {
  console.error(error);
  showFatal(
    `buildingblock failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
});
