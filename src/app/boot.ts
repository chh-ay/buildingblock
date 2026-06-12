/**
 * Boot policy: fatal overlay, storage keys, and the pre-construction decision
 * of which world dimensions to apply before anything world-sized exists.
 */

import type { WorldSnapshot } from "../core/types";
import { applyWorldDims, CHUNK_BITS, CHUNK_SIZE, WORLD_PRESETS } from "../core/types";
import { decodeSnapshot } from "../io/codec";
import { peekBootWorld } from "../io/saves";
import { fromBase64Url, parseAppHash } from "../io/share";

export const SIZE_STORAGE_KEY = "bb-world-size";
export const RENDERER_STORAGE_KEY = "bb-renderer";
export const SOUND_STORAGE_KEY = "bb-sound";
export const AUTOSAVE_STORAGE_KEY = "bb-autosave";
export const AUTOSAVE_SEC_STORAGE_KEY = "bb-autosave-sec";

/** Full-screen fatal error overlay; used for boot failures and GPU device loss. */
export const showFatal = (message: string): void => {
  const overlay = document.createElement("div");
  overlay.className = "fatal";
  overlay.textContent = message;
  document.body.appendChild(overlay);
};

export interface BootPlan {
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
export const resolveBootPlan = async (): Promise<BootPlan> => {
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
