/** Tiny dependency-free signal store + app-wide UI state and action contracts. */

export interface Signal<T> {
  (): T;
  set(v: T): void;
  /** Subscribe; fires immediately with the current value. Returns unsubscribe. */
  sub(fn: (v: T) => void): () => void;
}

export const signal = <T>(initial: T): Signal<T> => {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  const s = (() => value) as Signal<T>;
  s.set = (v: T) => {
    if (Object.is(v, value)) return;
    value = v;
    for (const fn of subs) fn(v);
  };
  s.sub = (fn) => {
    subs.add(fn);
    fn(value);
    return () => {
      subs.delete(fn);
    };
  };
  return s;
};

export type ToolId = "place" | "erase" | "paint" | "box" | "pick";

export type RendererPreference = "auto" | "webgl" | "webgpu";

export interface PerfStats {
  fps: number;
  /** Main-thread cost per frame. */
  frameMs: number;
  /** Worst frame gap inside the HUD window — the stutter signal. */
  worstFrameMs: number;
  /** Effective device pixel ratio in use. */
  dpr: number;
  drawCalls: number;
  triangles: number;
  chunksVisible: number;
  chunksTotal: number;
  remeshMs: number;
  remeshCount: number;
  queueDepth: number;
  voxels: number;
  states: number;
  backend: string;
}

export const emptyPerf = (): PerfStats => ({
  fps: 0,
  frameMs: 0,
  worstFrameMs: 0,
  dpr: 1,
  drawCalls: 0,
  triangles: 0,
  chunksVisible: 0,
  chunksTotal: 0,
  remeshMs: 0,
  remeshCount: 0,
  queueDepth: 0,
  voxels: 0,
  states: 0,
  backend: "...",
});

export interface ClassChip {
  id: number;
  name: string;
}

export interface PeerBadge {
  id: string;
  name: string;
  /** CSS color string for UI chips/labels. */
  color: string;
}

export interface AppState {
  tool: Signal<ToolId>;
  /** Block shape choice: 0 cube, 1 slab, 2 top slab, 3 ramp (auto-faces away from camera). */
  shape: Signal<number>;
  /** Current paint color, 0xRRGGBB. */
  color: Signal<number>;
  /** Current material class id. */
  cls: Signal<number>;
  swatches: Signal<readonly number[]>;
  recents: Signal<readonly number[]>;
  classes: Signal<readonly ClassChip[]>;
  grid: Signal<boolean>;
  shadows: Signal<boolean>;
  bloom: Signal<boolean>;
  hud: Signal<boolean>;
  /** Backend preference; changing it persists and reloads. */
  renderer: Signal<RendererPreference>;
  /** Render rate cap in fps (30 / 60 / 120); display refresh still bounds what you see. */
  fpsCap: Signal<number>;
  dprCap: Signal<number>;
  shadowRes: Signal<number>;
  helpOpen: Signal<boolean>;
  perf: Signal<PerfStats>;
  /** Sun direction: follow the host clock or stay where the sliders put it. */
  sunMode: Signal<"time" | "manual">;
  /** Sun direction controls, degrees. */
  sunAzimuth: Signal<number>;
  sunElevation: Signal<number>;
  /** Remote peers in the collab room; -1 = not in a room. */
  peers: Signal<number>;
  /** Collab roster with derived identities (empty when not in a room). */
  roster: Signal<readonly PeerBadge[]>;
  /** Transient status line; UI shows and auto-clears it. '' = none. */
  toast: Signal<string>;
  /** Gameplay sound effects toggle (persisted). */
  sound: Signal<boolean>;
  /** True while a build replay is running; input is blocked and a banner shows. */
  replaying: Signal<boolean>;
}

export const DEFAULT_SWATCHES: readonly number[] = [
  0xf4f4f0, 0xc9c9c2, 0x8e8e88, 0x52524e, 0x2b2b28, 0xd94f3d, 0xe8943a, 0xeed75a, 0x7fbf4d,
  0x3f9e6e, 0x3fa7c4, 0x3f6fc4, 0x7a5cc9, 0xc45cb0, 0x8a5a3b, 0xe9b58c,
];

export const createAppState = (): AppState => ({
  tool: signal<ToolId>("place"),
  shape: signal(0),
  color: signal(0xd94f3d),
  cls: signal(0),
  swatches: signal(DEFAULT_SWATCHES),
  recents: signal<readonly number[]>([]),
  classes: signal<readonly ClassChip[]>([
    { id: 0, name: "Matte" },
    { id: 1, name: "Gloss" },
    { id: 2, name: "Emissive" },
    { id: 3, name: "Glass" },
  ]),
  grid: signal(true),
  shadows: signal(true),
  bloom: signal(true),
  hud: signal(false),
  renderer: signal<RendererPreference>("auto"),
  fpsCap: signal(120),
  dprCap: signal(1.5),
  shadowRes: signal(2048),
  helpOpen: signal(false),
  perf: signal(emptyPerf()),
  sunMode: signal<"time" | "manual">("time"),
  sunAzimuth: signal(40),
  sunElevation: signal(55),
  peers: signal(-1),
  roster: signal<readonly PeerBadge[]>([]),
  toast: signal(""),
  sound: signal(true),
  replaying: signal(false),
});

export interface SaveMeta {
  name: string;
  updatedAt: number;
  bytes: number;
}

/** Implemented by the persistence layer; consumed by the UI. All failures surface as rejected promises. */
export interface AppActions {
  newWorld(): void;
  /** Create or reuse the collab room and copy the invite link. */
  share(): Promise<void>;
  save(name: string): Promise<void>;
  listSaves(): Promise<SaveMeta[]>;
  load(name: string): Promise<void>;
  deleteSave(name: string): Promise<void>;
  /** Download the world as a gzipped .bbk file. */
  exportFile(): Promise<void>;
  /** Accepts .bbk / .bbk.gz / .vox. */
  importFile(file: File): Promise<void>;
  exportVox(): Promise<void>;
  exportGlb(): Promise<void>;
  screenshot(): Promise<void>;
  frameCamera(): void;
  /** Copy a standalone link that encodes the whole build into the URL. */
  shareBuildLink(): Promise<void>;
  /** Browse featured scenes and load one. */
  openGallery(): Promise<void>;
  /** Rebuild the world brick-by-brick from the session journal. */
  startReplay(): void;
}
