/**
 * Gallery scene contract: pure builders that write voxels through a tiny ctx.
 * Scenes target a fixed chunk grid (cx/cy/cz) and must keep content inside it;
 * out-of-bounds writes are silently dropped by the ctx so a stray loop can
 * never corrupt a neighbouring chunk column.
 */
export {
  MaterialClass,
  SHAPE_CORNER_NXNZ,
  SHAPE_CORNER_NXPZ,
  SHAPE_CORNER_PXNZ,
  SHAPE_CORNER_PXPZ,
  SHAPE_CUBE,
  SHAPE_INNER_NXNZ,
  SHAPE_INNER_NXPZ,
  SHAPE_INNER_PXNZ,
  SHAPE_INNER_PXPZ,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
  SHAPE_VSLAB_NX,
  SHAPE_VSLAB_NZ,
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
} from "../../src/core/types";

/**
 * Runtime-registered material classes, by boot registration order in main.ts
 * (plasma, metal, water — appended after the four builtins). The ids are baked
 * into published .bbk files, so this order is append-only.
 */
export const CLS_PLASMA = 4;
export const CLS_METAL = 5;
export const CLS_WATER = 6;

export interface SceneCtx {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  /** Write one voxel. `shape` defaults to SHAPE_CUBE. Out-of-bounds writes are ignored. */
  set(x: number, y: number, z: number, cls: number, rgb: number, shape?: number): void;
  /** Erase one voxel (used to carve doors, windows, arches). */
  clear(x: number, y: number, z: number): void;
  /** Inclusive box fill. Coordinates may be given in any order per axis. */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    cls: number,
    rgb: number,
    shape?: number,
  ): void;
}

export interface SceneSpec {
  /** Kebab-case id; doubles as the published filename (`<id>.bbk.gz`, `<id>.png`). */
  id: string;
  /** Display name shown on the gallery card. */
  name: string;
  /** Short hook shown under the name (one clause, no trailing period). */
  blurb: string;
  /** Target world size in chunks; gallery scenes standardise on 3×2×3 (96×64×96 voxels). */
  cx: number;
  cy: number;
  cz: number;
  build(ctx: SceneCtx): void;
}

/** Bounds-checked ctx that forwards writes to `sink`/`erase` callbacks. */
export const createSceneCtx = (
  sx: number,
  sy: number,
  sz: number,
  sink: (x: number, y: number, z: number, cls: number, rgb: number, shape: number) => void,
  erase: (x: number, y: number, z: number) => void,
): SceneCtx => {
  const inBounds = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  const set = (x: number, y: number, z: number, cls: number, rgb: number, shape = 0): void => {
    if (inBounds(x, y, z)) sink(x, y, z, cls, rgb, shape);
  };
  const clear = (x: number, y: number, z: number): void => {
    if (inBounds(x, y, z)) erase(x, y, z);
  };
  const box = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    cls: number,
    rgb: number,
    shape = 0,
  ): void => {
    const [xa, xb] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ya, yb] = y0 <= y1 ? [y0, y1] : [y1, y0];
    const [za, zb] = z0 <= z1 ? [z0, z1] : [z1, z0];
    for (let y = ya; y <= yb; y++) {
      for (let z = za; z <= zb; z++) {
        for (let x = xa; x <= xb; x++) set(x, y, z, cls, rgb, shape);
      }
    }
  };
  return { sx, sy, sz, set, clear, box };
};
