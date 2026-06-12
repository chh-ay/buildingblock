/**
 * Zero-host P2P session over trystero (WebRTC data channels, public signaling
 * relays — no server of our own).
 *
 * NOTE: this project pins trystero@0.25.2, where the classic
 * `trystero/torrent` subpath is deprecated and throws at import time. The main
 * `"trystero"` entry re-exports the nostr strategy (`@trystero-p2p/nostr`),
 * which is the installed, supported transport — same zero-host model.
 *
 * Protocol (four message actions, all binary-safe):
 * - "edit":     broadcast voxel edits as one packed Uint8Array per batch.
 * - "needsnap": empty request a joiner sends to ask for the current world.
 * - "snap":     full world snapshot bytes, sent only to the requesting peer.
 * - "cur":      fire-and-forget presence cursor broadcasts (fixed-size record).
 */

import { joinRoom, selfId } from "trystero";

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

/** A peer's live pointer: hovered voxel, face, active tool, and accent color. */
export interface PresenceCursor {
  x: number;
  y: number;
  z: number;
  /** Hovered face id. */
  face: number;
  /** Active tool id. */
  tool: number;
  /** 24-bit RGB accent color. */
  color: number;
}

/** Host-side hooks the session needs; all are wrapped so throws never break the wire. */
export interface NetCallbacks {
  /** Apply edits received from a peer to the local world. */
  applyRemoteEdits(cells: RemoteCell[]): void;
  /** Encode the current world for a joining peer. */
  snapshotBytes(): Uint8Array;
  /** Replace the local world with a peer's snapshot. */
  restoreSnapshot(bytes: Uint8Array): void;
  /** Full set of connected peer ids; called on every join/leave and once initially with []. */
  onRoster(peerIds: readonly string[]): void;
  /** A peer's presence cursor changed; null = hidden (also emitted when the peer leaves). */
  onPeerCursor(peerId: string, cursor: PresenceCursor | null): void;
}

export interface JoinOptions {
  /**
   * True when this client just created the room (Share → Build together):
   * it is canonical immediately. Joiners arriving via a #r= link never claim
   * authority on a timer while alone — the snapshot wait only starts once a
   * peer actually connects (public-relay handshakes routinely beat 2.5 s).
   * A lonely joiner who starts building claims authority through its first
   * broadcast instead.
   */
  creator: boolean;
}

/** Live room handle returned by {@link joinBuildRoom}. */
export interface NetSession {
  readonly roomId: string;
  /** This client's trystero peer id. */
  readonly selfId: string;
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
  /**
   * Fire-and-forget presence broadcast; null hides the local cursor on all
   * peers. No throttling here — the caller throttles.
   */
  sendCursor(cursor: PresenceCursor | null): void;
  /** Disconnect from the room; no callbacks fire afterwards. */
  leave(): void;
}

/**
 * Wire record layout for the "edit" action, little-endian, 11 bytes per cell:
 *   u16 x | u16 y | u16 z | u32 key | u8 shape
 */
const RECORD_BYTES = 11;

/**
 * Wire layout for the "cur" action, little-endian, fixed 12 bytes:
 *   u16 x | u16 y | u16 z | u8 face | u8 tool | u32 color
 * A null (hidden) cursor is the same length with face = 255 and zeros elsewhere.
 */
const CURSOR_BYTES = 12;

/** Sentinel face value marking a null (hidden) cursor on the wire. */
const CURSOR_NULL_FACE = 255;

/** How long a connected joiner waits for a snapshot before deciding the room is dead. */
const SNAP_WAIT_MS = 2500;

/** Most deferred local edit cells held while unsynced; past this we claim authority instead. */
const PENDING_CELL_CAP = 8192;

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

/** Pack a presence cursor (or null) into the fixed-size wire record. */
const packCursor = (cursor: PresenceCursor | null): Uint8Array => {
  const bytes = new Uint8Array(CURSOR_BYTES);
  const view = new DataView(bytes.buffer);
  if (cursor === null) {
    view.setUint8(6, CURSOR_NULL_FACE);
    return bytes;
  }
  view.setUint16(0, cursor.x & 0xffff, true);
  view.setUint16(2, cursor.y & 0xffff, true);
  view.setUint16(4, cursor.z & 0xffff, true);
  view.setUint8(6, cursor.face & 0xff);
  view.setUint8(7, cursor.tool & 0xff);
  view.setUint32(8, cursor.color >>> 0, true);
  return bytes;
};

/** Parse a cursor record; undefined = malformed (ignore), null = hidden cursor. */
const parseCursor = (bytes: Uint8Array): PresenceCursor | null | undefined => {
  if (bytes.byteLength !== CURSOR_BYTES) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const face = view.getUint8(6);
  if (face === CURSOR_NULL_FACE) return null;
  return {
    x: view.getUint16(0, true),
    y: view.getUint16(2, true),
    z: view.getUint16(4, true),
    face,
    tool: view.getUint8(7),
    color: view.getUint32(8, true),
  };
};

/**
 * Join (or create) a build room. The joiner immediately asks peers for a world
 * snapshot; whoever already holds the canonical world (`synced`) answers with
 * a direct "snap". If no snapshot arrives within {@link SNAP_WAIT_MS} of the
 * last opportunity, this peer considers itself the canonical source.
 *
 * Snapshots are only accepted while a request is outstanding (see
 * `snapPending`), and local edits made during the wait are deferred so they
 * can be re-applied on top of the incoming snapshot instead of forking it.
 */
export const joinBuildRoom = (
  roomId: string,
  callbacks: NetCallbacks,
  opts: JoinOptions,
): NetSession => {
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

  /**
   * True while a snapshot request is outstanding: armed by `requestSnapshot`,
   * cleared when a snapshot applies or the creator-detection timeout claims
   * authority. "snap" payloads arriving while this is false are unsolicited
   * and ignored.
   */
  let snapPending = false;

  /**
   * Local edits made while unsynced with peers present, already packed into
   * wire records (packed keys are palette-independent, so they survive a
   * snapshot swap). On snapshot apply they are re-applied on top through the
   * applyRemoteEdits callback and then broadcast; on timeout or cap overflow
   * they are only broadcast — the local world already holds them.
   */
  let pendingBatches: Uint8Array[] = [];
  let pendingCells = 0;

  /** Hand back (and clear) the deferred local batches. */
  const takePending = (): Uint8Array[] => {
    const batches = pendingBatches;
    pendingBatches = [];
    pendingCells = 0;
    return batches;
  };

  const sendEditBytes = (bytes: Uint8Array): void => {
    editAction.send(bytes).catch((err) => {
      console.warn("net: edit send failed", err);
    });
  };

  /** Become canonical: stop waiting for a snapshot and broadcast any deferred local edits. */
  const markSynced = (): void => {
    synced = true;
    snapPending = false;
    clearTimeout(syncTimer);
    syncTimer = undefined;

    for (const batch of takePending()) sendEditBytes(batch);
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
      if (left || synced || !snapPending) return; // only a solicited first snapshot counts
      const bytes = asBytes(data);
      if (bytes === null) return;

      const deferred = takePending(); // before markSynced, which would broadcast without re-applying
      markSynced();
      safely("restoreSnapshot", () => callbacks.restoreSnapshot(bytes));

      // The snapshot replaced the world, wiping local edits made during the
      // wait; replay them on top through the remote-edit path, then broadcast.
      for (const batch of deferred) {
        const cells = parseEdits(batch);
        if (cells !== null) safely("applyRemoteEdits", () => callbacks.applyRemoteEdits(cells));
        sendEditBytes(batch);
      }
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

  const cursorAction = room.makeAction<Uint8Array>("cur", {
    onMessage: (data, context) => {
      if (left) return;
      const bytes = asBytes(data);
      const cursor = bytes === null ? undefined : parseCursor(bytes);
      if (cursor === undefined) return; // malformed payload — ignore
      safely("onPeerCursor", () => callbacks.onPeerCursor(context.peerId, cursor));
    },
  });

  const requestSnapshot = (target?: string): void => {
    if (!synced) snapPending = true;

    needSnapAction.send(null, target === undefined ? undefined : { target }).catch((err) => {
      console.warn("net: needsnap send failed", err);
    });
  };

  const notifyRoster = (): void => {
    if (left) return;
    const peerIds = Object.keys(room.getPeers());
    safely("onRoster", () => callbacks.onRoster(peerIds));
  };

  room.onPeerJoin = (peerId) => {
    if (left) return;
    notifyRoster();
    // Late WebRTC connections are common on public relays: re-ask each new
    // peer directly and give the snapshot a fresh window to arrive.
    if (!synced) {
      requestSnapshot(peerId);
      armSyncTimer();
    }
  };
  room.onPeerLeave = (peerId) => {
    if (left) return;
    notifyRoster();
    safely("onPeerCursor", () => callbacks.onPeerCursor(peerId, null));
  };

  notifyRoster(); // initial roster ([])

  if (opts.creator) {
    markSynced(); // the room is born from this world; nothing to wait for
  } else {
    requestSnapshot(); // joiner asks right away (no-op while nobody is connected)
  }

  return {
    roomId,
    selfId,
    broadcastEdits: (cells, stateTable, stateShapes) => {
      if (left) return;

      // Split-brain guard: while a snapshot may still replace this world,
      // edits sent now would be built on state about to vanish. Defer them
      // (packed) until the snapshot race resolves.
      if (!synced && Object.keys(room.getPeers()).length > 0) {
        const count = (cells.length / 5) | 0;
        if (pendingCells + count <= PENDING_CELL_CAP) {
          if (count > 0) {
            pendingBatches.push(packEdits(cells, stateTable, stateShapes));
            pendingCells += count;
          }
          return;
        }
        // Cap blown: this peer is clearly the one building — fall through to
        // claim authority (markSynced flushes the backlog) and send live.
      }

      markSynced(); // first local edit makes this world authoritative
      if (cells.length === 0) return;
      sendEditBytes(packEdits(cells, stateTable, stateShapes));
    },
    sendCursor: (cursor) => {
      if (left) return;
      cursorAction.send(packCursor(cursor)).catch((err) => {
        console.warn("net: cursor send failed", err);
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
