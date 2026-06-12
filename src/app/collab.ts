/**
 * Collaboration glue: zero-host WebRTC room membership, remote edit application,
 * roster → presence sync, and throttled hover-cursor broadcasts.
 */
import type { RayHit, WorldSnapshot } from "../core/types";
import { AIR, inWorld, SHAPE_COUNT, stateClass, stateRgb } from "../core/types";
import type { VoxelWorld } from "../core/world";
import { decodeSnapshot, encodeSnapshot } from "../io/codec";
import { derivePeerIdentity } from "../net/identity";
import { joinBuildRoom, type NetSession, type RemoteCell } from "../net/room";
import type { PresenceRenderer } from "../render/presence";
import type { SoundEngine } from "../sound";
import type { AppState, ToolId } from "../state";
import type { SpawnEditFx } from "./editing";

export interface CollabDeps {
  world: VoxelWorld;
  state: AppState;
  presence: PresenceRenderer;
  /** Join/leave pings and identity-reveal moments. */
  sound: SoundEngine;
  spawnEditFx: SpawnEditFx;
  /** Whole-world replacement; returns false when the page is rebooting into new dims. */
  restoreSnapshot(snapshot: WorldSnapshot, borrowed: boolean): boolean;
}

export interface Collab {
  /** Join a room; `creator` marks the share-flow client that owns the initial world. */
  join(roomId: string, opts: { creator: boolean }): void;
  leave(): void;
  active(): boolean;
  /** Broadcast committed cells to the room; no-op while not in a room. */
  broadcastEdits(cells: Int32Array): void;
  /** Throttled hover-cursor broadcast (12-byte records, trailing hide on null). */
  sendCursor(hit: RayHit | null): void;
}

const TOOL_WIRE_IDS: Record<ToolId, number> = { place: 0, erase: 1, paint: 2, box: 3, pick: 4 };

export const createCollab = (deps: CollabDeps): Collab => {
  const { world, state, presence } = deps;
  let net: NetSession | null = null;

  /** Hard ceiling on interned states; remote cells that would push past it are dropped. */
  const MAX_INTERNED_STATES = 60000;

  const applyRemoteEdits = (cells: RemoteCell[]): void => {
    let fxBudget = 24;
    const classCount = state.classes().length;

    for (const cell of cells) {
      // Validate BEFORE interning: a hostile peer must not flood the palette
      // with garbage keys or write outside the world.
      if (!inWorld(cell.x, cell.y, cell.z)) continue;
      if (cell.shape >= SHAPE_COUNT) continue;
      if (cell.key !== 0 && stateClass(cell.key) >= classCount) continue;
      if (cell.key !== 0 && world.stateCount >= MAX_INTERNED_STATES) continue;

      const stateId =
        cell.key === 0
          ? AIR
          : world.internState(stateClass(cell.key), stateRgb(cell.key), cell.shape);
      const prevId = world.get(cell.x, cell.y, cell.z);
      if (!world.set(cell.x, cell.y, cell.z, stateId)) continue;

      if (fxBudget > 0 && deps.spawnEditFx(cell.x, cell.y, cell.z, prevId, stateId)) fxBudget--;
    }
  };

  // ── social moments ──────────────────────────────────────────────────────────

  /** Peers connecting inside this window after join are the initial burst, not news. */
  const JOIN_BURST_MS = 3000;

  let knownPeers = new Set<string>();
  let rosterSeeded = false;
  let joinedAt = 0;

  /** Toast + ping roster diffs; the seeding callback and the join burst stay silent. */
  const announceRosterDiff = (peerIds: readonly string[]): void => {
    const prev = knownPeers;
    knownPeers = new Set(peerIds);

    if (!rosterSeeded) {
      rosterSeeded = true;
      return;
    }

    const inJoinBurst = performance.now() - joinedAt < JOIN_BURST_MS;
    for (const id of peerIds) {
      if (prev.has(id) || inJoinBurst) continue;
      state.toast.set(`${derivePeerIdentity(id).name} joined`);
      deps.sound.play("ui");
    }

    for (const id of prev) {
      if (knownPeers.has(id)) continue;
      state.toast.set(`${derivePeerIdentity(id).name} left`);
      deps.sound.play("pick");
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

    announceRosterDiff(peerIds);

    document.title =
      peerIds.length > 0 ? `buildingblock — ${peerIds.length + 1} building` : "buildingblock";
  };

  const join = (roomId: string, opts: { creator: boolean }): void => {
    if (net) return;

    knownPeers = new Set();
    rosterSeeded = false;
    joinedAt = performance.now();

    net = joinBuildRoom(
      roomId,
      {
        applyRemoteEdits,
        snapshotBytes: () => encodeSnapshot(world.toSnapshot()),
        restoreSnapshot: (bytes) => deps.restoreSnapshot(decodeSnapshot(bytes), true),
        onRoster: syncRoster,
        onPeerCursor: (peerId, cursor) => presence.setCursor(peerId, cursor),
      },
      { creator: opts.creator },
    );
    state.peers.set(0);
    state.toast.set(`You are ${derivePeerIdentity(net.selfId).name}`);
  };

  const leave = (): void => {
    if (!net) return;

    net.leave();
    net = null;
    knownPeers = new Set();
    rosterSeeded = false;
    presence.clear();
    state.roster.set([]);
    state.peers.set(-1);
    document.title = "buildingblock";
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  // ── hover presence ──────────────────────────────────────────────────────────

  let lastCursorSentAt = 0;
  let cursorVisibleRemotely = false;

  const sendCursor = (hit: RayHit | null): void => {
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

  return {
    join,
    leave,
    active: () => net !== null,
    broadcastEdits: (cells) => {
      net?.broadcastEdits(cells, world.stateTable, world.stateShapes);
    },
    sendCursor,
  };
};
