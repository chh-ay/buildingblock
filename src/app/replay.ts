/**
 * Build replay: rebuilds the world from the edit journal under an orbiting
 * cinematic camera, with a transport (pause/scrub/speed/skip) and a synthetic
 * "showcase" mode that stages gallery/shared worlds as bottom-up construction.
 */
import { Vector3 } from "three";
import {
  type EditJournal,
  type JournalEntry,
  replayDurationMs,
  replayedCountAt,
} from "../core/journal";
import type { WorldSnapshot } from "../core/types";
import {
  AIR,
  CHUNK_BITS,
  CHUNK_SIZE,
  stateClass,
  stateRgb,
  WORLD_CX,
  WORLD_CZ,
} from "../core/types";
import type { VoxelWorld } from "../core/world";
import type { UndoStack } from "../interact/undo";
import { decodeSnapshot } from "../io/codec";
import type { SaveStore } from "../io/saves";
import type { CameraRig } from "../render/camera";
import type { VoxelFx } from "../render/particles";
import type { SoundEngine } from "../sound";
import type { AppState } from "../state";
import { createReplayTransport, type ReplayTransport } from "../ui/transport";
import type { OrbitCenter, OrbitMath } from "./orbit";

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
  center: OrbitCenter;
  radius: number;
  /** Decoded once so backward seeks can rebuild without re-parsing the baseline. */
  baselineSnapshot: WorldSnapshot | null;
  lastTickSoundAt: number;
  savedCameraPos: Vector3;
  savedTarget: Vector3;
  /** Camera pose the orbit eases away from; refreshed on every resume. */
  blendPos: Vector3;
  blendTarget: Vector3;
  blendFrom: number;
  blocker: HTMLDivElement;
  transport: ReplayTransport;
  homeAfter: boolean;
}

export interface ReplayDeps {
  world: VoxelWorld;
  journal: EditJournal;
  undo: UndoStack;
  saves: SaveStore;
  state: AppState;
  sound: SoundEngine;
  fx: VoxelFx;
  cameraRig: CameraRig;
  orbit: OrbitMath;
  /** Replays are solo; the controller refuses to start while in a room. */
  collabActive(): boolean;
  /** Suspends journal recording while the replay itself writes the world. */
  setJournalTracking(on: boolean): void;
}

export interface ReplayController {
  begin(homeAfter?: boolean): void;
  /** Rebuild the journal as a synthetic bottom-up construction sequence. */
  stageShowcase(snapshot: WorldSnapshot): void;
  /** Per-frame tick from the render loop; no-op while inactive. */
  step(now: number): void;
  active(): boolean;
  /** Toast + true while a replay should block world-mutating actions. */
  busy(): boolean;
}

export const createReplayController = (deps: ReplayDeps): ReplayController => {
  const { world, journal, undo, saves, state, sound, fx, cameraRig, orbit } = deps;

  const scratchOrbitPos = new Vector3();
  const scratchOrbitTarget = new Vector3();
  const journalScratch: JournalEntry = { x: 0, y: 0, z: 0, key32: 0, shape: 0 };
  let replayRun: ReplayRun | null = null;

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
    deps.setJournalTracking(true);

    // Intern order is deterministic, so ids only diverge when states were interned but never
    // written (preview-only); then the undo stack's ids are unsafe and it resets.
    if (world.stateCount !== replayRun.statesBefore) undo.clear();

    if (replayRun.homeAfter) {
      orbit.frameHero();
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

  const begin = (homeAfter = false): void => {
    if (replayRun) return;

    if (deps.collabActive()) {
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

    const { center, radius } = orbit.orbitFrame();

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
    deps.setJournalTracking(false);
    saves.hold();
    sound.play("ui");

    if (replayRun.baselineSnapshot) world.loadSnapshot(replayRun.baselineSnapshot);
    else world.clear();
  };

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

    // Bottom-up, then radially outward: reads like a build crew working from the middle out.
    const centerX = sumX / cells.length;
    const centerZ = sumZ / cells.length;
    for (const cell of cells) {
      const dx = cell.x - centerX;
      const dz = cell.z - centerZ;
      cell.order = cell.y * 1_000_000 + dx * dx + dz * dz;
    }
    cells.sort((a, b) => a.order - b.order);

    journal.reset(null);
    for (const cell of cells) journal.record(cell.x, cell.y, cell.z, cell.key32, cell.shape);
  };

  const step = (now: number): void => {
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
      orbit.orbitPoint(
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

  return {
    begin,
    stageShowcase,
    step,
    active: () => replayRun !== null,
    busy: () => {
      if (!state.replaying()) return false;
      state.toast.set("Finish or skip the replay first");
      return true;
    },
  };
};
