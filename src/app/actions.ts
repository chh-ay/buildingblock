/**
 * The AppActions surface the UI calls into: world lifecycle, saves, sharing,
 * import/export, gallery, and replay entry points.
 */

import type { WorldSnapshot } from "../core/types";
import { WORLD_CX, WORLD_CY, WORLD_CZ, WORLD_PRESETS } from "../core/types";
import type { VoxelWorld } from "../core/world";
import type { UndoStack } from "../interact/undo";
import { decodeSnapshot, encodeSnapshot } from "../io/codec";
import { exportGlbFile } from "../io/gltf";
import type { SaveStore } from "../io/saves";
import { buildShareUrl } from "../io/share";
import { randomRoomId } from "../net/room";
import type { CameraRig } from "../render/camera";
import type { ChunkRenderer } from "../render/chunks";
import type { SoundEngine } from "../sound";
import type { AppActions, AppState } from "../state";
import { confirmDialog } from "../ui/confirm";
import { openGallery as openGalleryModal } from "../ui/gallery";
import { pickWorldSize } from "../ui/size-picker";
import { SIZE_STORAGE_KEY } from "./boot";
import type { Collab } from "./collab";
import type { OrbitMath } from "./orbit";
import type { ReplayController } from "./replay";

export interface ActionDeps {
  state: AppState;
  world: VoxelWorld;
  undo: UndoStack;
  saves: SaveStore;
  collab: Collab;
  replay: ReplayController;
  sound: SoundEngine;
  cameraRig: CameraRig;
  orbit: OrbitMath;
  chunkRenderer: ChunkRenderer;
  canvas: HTMLCanvasElement;
  worldOffsetX: number;
  worldOffsetZ: number;
  /** Renders one frame so canvas.toBlob captures fresh pixels (WebGPU clears otherwise). */
  present(): void;
  /** Whole-world replacement; returns false when the page is rebooting into new dims. */
  restoreSnapshot(snapshot: WorldSnapshot, borrowed: boolean): boolean;
}

const download = (data: Blob, filename: string): void => {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const createAppActions = (deps: ActionDeps): AppActions => {
  const { state, world, undo, saves, collab, replay, sound, cameraRig, orbit } = deps;

  return {
    newWorld: () => {
      if (replay.busy()) return;

      void (async () => {
        collab.leave();
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
      if (replay.busy()) return;

      if (!collab.active()) {
        const roomId = randomRoomId();
        window.location.hash = `r=${roomId}`;
        collab.join(roomId, { creator: true });
      }
      await navigator.clipboard.writeText(window.location.href);
      state.toast.set("Invite link copied — building together");
    },

    save: async (name) => {
      if (replay.busy()) return;
      await saves.saveAs(name);
      state.toast.set(`Saved "${name}"`);
    },

    listSaves: () => saves.list(),

    load: async (name) => {
      if (replay.busy()) return;
      collab.leave();
      await saves.load(name);
      state.toast.set(`Loaded "${name}"`);
    },

    deleteSave: (name) => saves.remove(name),

    exportFile: () => saves.exportBbkFile(),

    importFile: async (file) => {
      if (replay.busy()) return;
      collab.leave();
      await saves.importAnyFile(file);
      state.toast.set(`Imported ${file.name}`);
    },

    exportVox: () => saves.exportVoxFile(),

    exportGlb: () =>
      exportGlbFile(deps.chunkRenderer.buildExportGroup(-deps.worldOffsetX, -deps.worldOffsetZ)),

    screenshot: async () => {
      deps.present();
      const { promise, resolve } = Promise.withResolvers<Blob | null>();
      deps.canvas.toBlob(resolve, "image/png");
      const blob = await promise;
      if (!blob) throw new Error("screenshot capture failed");
      download(blob, `buildingblock-${Date.now()}.png`);
    },

    frameCamera: () => cameraRig.frame(world.contentBounds()),

    shareBuildLink: async () => {
      if (replay.busy()) return;

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
      if (replay.busy()) return;

      const baseUrl =
        (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
      const pick = await openGalleryModal(baseUrl);
      if (!pick) return;

      collab.leave();
      sound.play("ui");

      const snapshot = decodeSnapshot(pick.data);
      if (!deps.restoreSnapshot(snapshot, true)) return; // dim change: page reboots into the scene

      replay.stageShowcase(snapshot);
      orbit.frameHero();
      state.toast.set(`"${pick.entry.name}" loaded`);

      const watch = await confirmDialog({
        title: `Watch "${pick.entry.name}" come together?`,
        body: "A short construction replay. Scrub, pause, change speed, or skip anytime.",
        yes: "Watch the build",
        no: "Just explore",
      });
      if (watch && !replay.active()) replay.begin(true);
    },

    startReplay: () => replay.begin(),

    leaveRoom: () => {
      if (!collab.active()) return;
      collab.leave();
      state.toast.set("Left the room — back to solo");
    },

    copyInvite: async () => {
      if (!collab.active()) return;
      await navigator.clipboard.writeText(window.location.href);
      state.toast.set("Invite link copied");
    },
  };
};
