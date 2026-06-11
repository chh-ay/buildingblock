/** Persistence orchestration: autosave debouncing, named saves, and file import/export. */

import type { WorldSnapshot } from "../core/types";
import type { SaveMeta } from "../state";
import { decodeSnapshot, encodeSnapshot, peekDims } from "./codec";
import { idbAll, idbDelete, idbGet, idbPut, openSavesDb } from "./idb";
import { exportVox, importVox } from "./vox";

/** Reserved record name used by the rolling autosave slot. */
export const AUTOSAVE_NAME = "__auto";

const AUTOSAVE_DELAY_MS = 1500;

interface SaveHooks {
  snapshot(): WorldSnapshot;
  restore(s: WorldSnapshot): void;
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

/** Reads just the world dims from the autosave slot's BBK header, before any construction. */
export const peekAutosaveDims = async (): Promise<{
  sx: number;
  sy: number;
  sz: number;
} | null> => {
  try {
    const rec = await idbGet(await openSavesDb(), AUTOSAVE_NAME);
    if (!rec) return null;
    return peekDims(new Uint8Array(rec.data));
  } catch {
    return null;
  }
};

/** World persistence facade: debounced autosave plus named-save and file IO. */
export class SaveStore {
  private readonly hooks: SaveHooks;
  private dbPromise: Promise<IDBDatabase> | undefined;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(hooks: SaveHooks) {
    this.hooks = hooks;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.flush();
    });
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openSavesDb();
    return this.dbPromise;
  }

  private async writeAutosave(): Promise<void> {
    try {
      const data = toArrayBuffer(encodeSnapshot(this.hooks.snapshot()));
      await idbPut(await this.db(), { name: AUTOSAVE_NAME, updatedAt: Date.now(), data });
    } catch (err) {
      console.warn("autosave failed", err);
    }
  }

  /** Schedule a trailing-debounced autosave; never throws into edit paths. */
  autosaveSoon(): void {
    if (this.autosaveTimer !== undefined) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = undefined;
      void this.writeAutosave();
    }, AUTOSAVE_DELAY_MS);
  }

  /** Cancel any pending autosave timer and write the autosave slot now. */
  flush(): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    return this.writeAutosave();
  }

  /** Restore the autosave slot when present; resolves true when a world was loaded. */
  async loadAutosave(): Promise<boolean> {
    const rec = await idbGet(await this.db(), AUTOSAVE_NAME);
    if (!rec) return false;
    this.hooks.restore(decodeSnapshot(new Uint8Array(rec.data)));
    return true;
  }

  /** Overwrite the autosave slot with an explicit snapshot (world-size restarts). */
  async stashAutosave(snapshot: WorldSnapshot): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    const data = toArrayBuffer(encodeSnapshot(snapshot));
    await idbPut(await this.db(), { name: AUTOSAVE_NAME, updatedAt: Date.now(), data });
  }

  /** Drop the autosave slot (fresh world flows). */
  async clearAutosave(): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    await idbDelete(await this.db(), AUTOSAVE_NAME);
  }

  /** Persist the current world under a user-chosen name. */
  async saveAs(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") throw new Error("save name must not be empty");
    if (trimmed === AUTOSAVE_NAME) throw new Error(`'${AUTOSAVE_NAME}' is reserved for autosave`);
    const data = toArrayBuffer(encodeSnapshot(this.hooks.snapshot()));
    await idbPut(await this.db(), { name: trimmed, updatedAt: Date.now(), data });
  }

  /** List named saves (autosave excluded), most recently updated first. */
  async list(): Promise<SaveMeta[]> {
    const recs = await idbAll(await this.db());
    return recs
      .filter((r) => r.name !== AUTOSAVE_NAME)
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
