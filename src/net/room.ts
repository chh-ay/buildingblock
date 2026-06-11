/**
 * Zero-host P2P session over trystero (WebRTC data channels, public signaling
 * relays — no server of our own).
 *
 * NOTE: this project pins trystero@0.25.2, where the classic
 * `trystero/torrent` subpath is deprecated and throws at import time. The main
 * `"trystero"` entry re-exports the nostr strategy (`@trystero-p2p/nostr`),
 * which is the installed, supported transport — same zero-host model.
 *
 * Protocol (three message actions, all binary-safe):
 * - "edit":     broadcast voxel edits as one packed Uint8Array per batch.
 * - "needsnap": empty request a joiner sends to ask for the current world.
 * - "snap":     full world snapshot bytes, sent only to the requesting peer.
 */

import { joinRoom } from "trystero";

/** One remote voxel edit: world coords plus packed state key and shape id. */
export interface RemoteCell {
  x: number;
  y: number;
  z: number;
  /** Packed (class << 24 | rgb) state key; 0 = AIR. */
  key: number;
  /** Shape id (SHAPE_*); 0 when AIR. */
  shape: number;
}

/** Host-side hooks the session needs; all are wrapped so throws never break the wire. */
export interface NetCallbacks {
  /** Apply edits received from a peer to the local world. */
  applyRemoteEdits(cells: RemoteCell[]): void;
  /** Encode the current world for a joining peer. */
  snapshotBytes(): Uint8Array;
  /** Replace the local world with a peer's snapshot. */
  restoreSnapshot(bytes: Uint8Array): void;
  /** Connected-peer count changed (also called once with the initial 0). */
  onPeers(count: number): void;
}

/** Live room handle returned by {@link joinBuildRoom}. */
export interface NetSession {
  readonly roomId: string;
  /**
   * Broadcast a batch of local edits. `cells` uses the undo command layout:
   * [x, y, z, beforeStateId, afterStateId] × n; the after-state id is
   * translated to a packed key/shape via the palette tables (AIR → 0/0).
   */
  broadcastEdits(
    cells: Int32Array,
    stateTable: readonly number[],
    stateShapes: readonly number[],
  ): void;
  /** Disconnect from the room; no callbacks fire afterwards. */
  leave(): void;
}

/**
 * Wire record layout for the "edit" action, little-endian, 11 bytes per cell:
 *   u16 x | u16 y | u16 z | u32 key | u8 shape
 */
const RECORD_BYTES = 11;

/** How long a joiner waits for a snapshot before deciding it is the room creator. */
const SNAP_WAIT_MS = 2500;

const APP_ID = "buildingblock-v1";

/** Run a host callback, downgrading any throw to a warning so the wire stays up. */
const safely = (what: string, fn: () => void): void => {
  try {
    fn();
  } catch (err) {
    console.warn(`net: ${what} callback failed`, err);
  }
};

/** Coerce an incoming binary payload to Uint8Array, or null when it isn't binary. */
const asBytes = (data: unknown): Uint8Array | null => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
};

/** Parse a packed edit payload; null when the payload is malformed. */
const parseEdits = (bytes: Uint8Array): RemoteCell[] | null => {
  if (bytes.byteLength === 0 || bytes.byteLength % RECORD_BYTES !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength / RECORD_BYTES;
  const cells: RemoteCell[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * RECORD_BYTES;
    cells[i] = {
      x: view.getUint16(o, true),
      y: view.getUint16(o + 2, true),
      z: view.getUint16(o + 4, true),
      key: view.getUint32(o + 6, true),
      shape: view.getUint8(o + 10),
    };
  }
  return cells;
};

/**
 * Pack undo-format cells ([x, y, z, before, after] × n) into the 11-byte wire
 * records described at {@link RECORD_BYTES}. AIR (state id 0) maps to
 * key 0 / shape 0; other ids are resolved through the palette tables.
 */
const packEdits = (
  cells: Int32Array,
  stateTable: readonly number[],
  stateShapes: readonly number[],
): Uint8Array => {
  const count = (cells.length / 5) | 0;
  const bytes = new Uint8Array(count * RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) {
    const c = i * 5;
    const o = i * RECORD_BYTES;
    const after = cells[c + 4];
    view.setUint16(o, cells[c] & 0xffff, true);
    view.setUint16(o + 2, cells[c + 1] & 0xffff, true);
    view.setUint16(o + 4, cells[c + 2] & 0xffff, true);
    view.setUint32(o + 6, after === 0 ? 0 : (stateTable[after] ?? 0) >>> 0, true);
    view.setUint8(o + 10, after === 0 ? 0 : (stateShapes[after] ?? 0) & 0xff);
  }
  return bytes;
};

/**
 * Join (or create) a build room. The joiner immediately asks peers for a world
 * snapshot; whoever already holds the canonical world (`synced`) answers with
 * a direct "snap". If no snapshot arrives within {@link SNAP_WAIT_MS} of the
 * last opportunity, this peer considers itself the canonical source.
 */
export const joinBuildRoom = (roomId: string, callbacks: NetCallbacks): NetSession => {
  const room = joinRoom({ appId: APP_ID }, roomId);

  /**
   * True once this peer holds the canonical world: a snapshot was applied, it
   * made its first local broadcast, or the snapshot wait elapsed (room
   * creator). Only synced peers answer "needsnap"; unsynced peers apply the
   * first "snap" they receive and ignore the rest.
   */
  let synced = false;
  let left = false;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;

  const markSynced = (): void => {
    synced = true;
    clearTimeout(syncTimer);
    syncTimer = undefined;
  };

  /** (Re)arm the creator-detection timer: no snap within the window → we are canonical. */
  const armSyncTimer = (): void => {
    if (synced || left) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(markSynced, SNAP_WAIT_MS);
  };

  const editAction = room.makeAction<Uint8Array>("edit", {
    onMessage: (data) => {
      if (left) return;
      const bytes = asBytes(data);
      const cells = bytes === null ? null : parseEdits(bytes);
      if (cells === null) return; // malformed payload — ignore
      safely("applyRemoteEdits", () => callbacks.applyRemoteEdits(cells));
    },
  });

  const snapAction = room.makeAction<Uint8Array>("snap", {
    onMessage: (data) => {
      if (left || synced) return; // only the first snapshot counts
      const bytes = asBytes(data);
      if (bytes === null) return;
      markSynced();
      safely("restoreSnapshot", () => callbacks.restoreSnapshot(bytes));
    },
  });

  const needSnapAction = room.makeAction<null>("needsnap", {
    onMessage: (_data, context) => {
      if (left || !synced) return; // joiners awaiting a snapshot never answer
      let bytes: Uint8Array | null = null;
      safely("snapshotBytes", () => {
        bytes = callbacks.snapshotBytes();
      });
      if (bytes === null) return;
      snapAction.send(bytes, { target: context.peerId }).catch((err) => {
        console.warn("net: snap send failed", err);
      });
    },
  });

  const requestSnapshot = (target?: string): void => {
    needSnapAction.send(null, target === undefined ? undefined : { target }).catch((err) => {
      console.warn("net: needsnap send failed", err);
    });
  };

  const peerCount = (): number => Object.keys(room.getPeers()).length;

  const notifyPeers = (): void => {
    if (left) return;
    const count = peerCount();
    safely("onPeers", () => callbacks.onPeers(count));
  };

  room.onPeerJoin = (peerId) => {
    if (left) return;
    notifyPeers();
    // Late WebRTC connections are common on public relays: re-ask each new
    // peer directly and give the snapshot a fresh window to arrive.
    if (!synced) {
      requestSnapshot(peerId);
      armSyncTimer();
    }
  };
  room.onPeerLeave = () => {
    notifyPeers();
  };

  notifyPeers(); // initial count (0)
  requestSnapshot(); // joiner asks right away (no-op while nobody is connected)
  armSyncTimer();

  return {
    roomId,
    broadcastEdits: (cells, stateTable, stateShapes) => {
      if (left) return;
      markSynced(); // first local edit makes this world authoritative
      if (cells.length === 0) return;
      editAction.send(packEdits(cells, stateTable, stateShapes)).catch((err) => {
        console.warn("net: edit send failed", err);
      });
    },
    leave: () => {
      if (left) return;
      left = true;
      clearTimeout(syncTimer);
      syncTimer = undefined;
      room.onPeerJoin = null;
      room.onPeerLeave = null;
      room.leave().catch((err) => {
        console.warn("net: leave failed", err);
      });
    },
  };
};

/** Random room id: 10 lowercase base36 chars from crypto.getRandomValues. */
export const randomRoomId = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(16);
  let id = "";
  while (id.length < 10) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      // Rejection-sample to keep the distribution uniform (252 = 36 * 7).
      if (byte < 252 && id.length < 10) id += alphabet.charAt(byte % 36);
    }
  }
  return id;
};
