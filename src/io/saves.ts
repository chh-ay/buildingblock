/** Persistence orchestration: autosave debouncing, named saves, and file import/export. */

import type { WorldSnapshot } from "../core/types";
import type { SaveMeta } from "../state";
import { decodeSnapshot, encodeSnapshot, peekDims } from "./codec";
import { idbAll, idbDelete, idbGet, idbPut, openSavesDb } from "./idb";
import { exportVox, importVox } from "./vox";

/** Reserved record name used by the rolling autosave slot. */
export const AUTOSAVE_NAME = "__auto";

/** Reserved record name parking a borrowed world (gallery scene / shared build) across a dim-change reload. */
export const PENDING_NAME = "__pending";

/** Autosave writes are interval-throttled; 30 s is the floor (cheap on storage, safe on loss). */
const MIN_AUTOSAVE_DELAY_MS = 30_000;

interface SaveHooks {
  snapshot(): WorldSnapshot;
  restore(s: WorldSnapshot): void;
  /** Fired after each successful autosave write (UI may surface it, throttled). */
  onAutosaved?(): void;
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
};

const stamp = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

const download = (bytes: Uint8Array<ArrayBuffer> | ArrayBuffer, filename: string): void => {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const asciiTag = (bytes: Uint8Array): string =>
  String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);

/** Boot peek: a pending parked world wins over the autosave slot; dims read before any construction. */
export const peekBootWorld = async (): Promise<{
  sx: number;
  sy: number;
  sz: number;
  pending: boolean;
} | null> => {
  try {
    const db = await openSavesDb();
    const parked = await idbGet(db, PENDING_NAME);
    if (parked) {
      const dims = peekDims(new Uint8Array(parked.data));
      if (dims) return { ...dims, pending: true };
      await idbDelete(db, PENDING_NAME);
    }
    const rec = await idbGet(db, AUTOSAVE_NAME);
    if (!rec) return null;
    const dims = peekDims(new Uint8Array(rec.data));
    return dims ? { ...dims, pending: false } : null;
  } catch {
    return null;
  }
};

/** World persistence facade: debounced autosave plus named-save and file IO. */
export class SaveStore {
  private readonly hooks: SaveHooks;
  private dbPromise: Promise<IDBDatabase> | undefined;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** While held, autosaves are suppressed: the world on screen is borrowed until the user edits. */
  private held = false;
  /** User policy: master switch + write interval (Settings → Autosave). */
  private autosaveEnabled = true;
  private autosaveDelayMs = MIN_AUTOSAVE_DELAY_MS;

  constructor(hooks: SaveHooks) {
    this.hooks = hooks;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.flush();
    });
  }

  /**
   * Apply the user's autosave policy. Disabling cancels any pending write and
   * also silences flush() — "off" means the user owns persistence entirely.
   */
  setAutosavePolicy(enabled: boolean, delayMs: number): void {
    this.autosaveEnabled = enabled;
    this.autosaveDelayMs = Math.max(MIN_AUTOSAVE_DELAY_MS, delayMs);
    if (!enabled && this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openSavesDb();
    return this.dbPromise;
  }
  private async writeAutosave(): Promise<void> {
    if (this.held) return;
    try {
      const data = toArrayBuffer(encodeSnapshot(this.hooks.snapshot()));
      await idbPut(await this.db(), { name: AUTOSAVE_NAME, updatedAt: Date.now(), data });
      this.hooks.onAutosaved?.();
    } catch (err) {
      console.warn("autosave failed", err);
    }
  }

  /**
   * Interval-throttled autosave: the first dirty edit arms the timer and later
   * edits never reset it, so a building session writes at most once per delay
   * window and never goes unsaved longer than one window. Never throws into
   * edit paths; tab-hide flush() covers quitting before the timer fires.
   */
  autosaveSoon(): void {
    if (this.held || !this.autosaveEnabled) return;
    if (this.autosaveTimer !== undefined) return;

    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = undefined;
      void this.writeAutosave();
    }, this.autosaveDelayMs);
  }

  /** Cancel any pending autosave timer and write the autosave slot now (no-op while held). */
  flush(): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    if (this.held || !this.autosaveEnabled) return Promise.resolve();
    return this.writeAutosave();
  }

  /** Restore the autosave slot when present; resolves true when a world was loaded. */
  async loadAutosave(): Promise<boolean> {
    const rec = await idbGet(await this.db(), AUTOSAVE_NAME);
    if (!rec) return false;
    this.hooks.restore(decodeSnapshot(new Uint8Array(rec.data)));
    return true;
  }

  /** Park a snapshot for a dim-change reload; the autosave slot stays intact. */
  async stashPending(snapshot: WorldSnapshot): Promise<void> {
    const data = toArrayBuffer(encodeSnapshot(snapshot));
    await idbPut(await this.db(), { name: PENDING_NAME, updatedAt: Date.now(), data });
  }

  /** Restore and consume the parked world; holds autosaves so it stays borrowed. */
  async loadPending(): Promise<boolean> {
    const db = await this.db();
    const rec = await idbGet(db, PENDING_NAME);
    if (!rec) return false;
    await idbDelete(db, PENDING_NAME);
    this.held = true;
    this.hooks.restore(decodeSnapshot(new Uint8Array(rec.data)));
    return true;
  }

  /** Suppress autosaves while showing a borrowed world (gallery scene, shared build, collab join). */
  hold(): void {
    this.held = true;
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
  }

  /** Resume autosaves; the next edit persists the world as the user's own. */
  release(): void {
    this.held = false;
  }

  /** Drop the autosave and any parked world (fresh-world flows); autosaves resume. */
  async clearAutosave(): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    this.held = false;
    const db = await this.db();
    await idbDelete(db, AUTOSAVE_NAME);
    await idbDelete(db, PENDING_NAME);
  }

  /** Persist the current world under a user-chosen name. */
  async saveAs(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") throw new Error("save name must not be empty");
    if (trimmed.startsWith("__")) throw new Error("names starting with '__' are reserved");
    const data = toArrayBuffer(encodeSnapshot(this.hooks.snapshot()));
    await idbPut(await this.db(), { name: trimmed, updatedAt: Date.now(), data });
  }

  /** List named saves (autosave excluded), most recently updated first. */
  async list(): Promise<SaveMeta[]> {
    const recs = await idbAll(await this.db());
    return recs
      .filter((r) => !r.name.startsWith("__"))
      .map((r) => ({ name: r.name, updatedAt: r.updatedAt, bytes: r.data.byteLength }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Restore a named save; rejects when the name is unknown. */
  async load(name: string): Promise<void> {
    const rec = await idbGet(await this.db(), name);
    if (!rec) throw new Error(`save '${name}' not found`);
    this.hooks.restore(decodeSnapshot(new Uint8Array(rec.data)));
  }

  /** Delete a named save. */
  async remove(name: string): Promise<void> {
    await idbDelete(await this.db(), name);
  }

  /** Download the world as a .bbk.gz file (raw .bbk where CompressionStream is missing). */
  async exportBbkFile(): Promise<void> {
    const bytes = encodeSnapshot(this.hooks.snapshot());
    if (typeof CompressionStream !== "undefined") {
      const gz = await new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer();
      download(gz, `world-${stamp()}.bbk.gz`);
    } else {
      download(bytes, `world-${stamp()}.bbk`);
    }
  }

  /** Download the world as a MagicaVoxel .vox file. */
  async exportVoxFile(): Promise<void> {
    download(exportVox(this.hooks.snapshot()), `world-${stamp()}.vox`);
  }

  /** Import a .bbk(.gz) or .vox file, restore it, and schedule an autosave. */
  async importAnyFile(file: File): Promise<void> {
    let buf = await file.arrayBuffer();
    let bytes = new Uint8Array(buf);
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      buf = await new Response(
        new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer();
      bytes = new Uint8Array(buf);
    }
    const tag = asciiTag(bytes);
    let snap: WorldSnapshot;
    if (tag === "VOX ") snap = importVox(bytes);
    else if (tag === "BBK1") snap = decodeSnapshot(bytes);
    else throw new Error("unrecognized file");
    this.hooks.restore(snap);
    this.autosaveSoon();
  }
}
