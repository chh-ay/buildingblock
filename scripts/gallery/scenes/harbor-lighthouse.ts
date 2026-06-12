import type { SceneCtx, SceneSpec } from "../scene";
import {
  CLS_METAL,
  CLS_WATER,
  MaterialClass,
  SHAPE_CORNER_NXNZ,
  SHAPE_CORNER_NXPZ,
  SHAPE_CORNER_PXNZ,
  SHAPE_CORNER_PXPZ,
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
} from "../scene";

/**
 * Harbor Lighthouse — a rocky cove at golden hour.
 *
 * Layout (hero camera looks from +X/-Z, so back-right of frame is low X):
 * a terraced headland anchored to the west edge steps down x=20 → 25 → 30
 * into a calm slab-sheet sea; every step is a complete ramp contour run with
 * a corner wedge where the east and south runs meet. The striped tower rides
 * a crisp square-cliffed crag at (7, 64); the keeper's cottage nestles below
 * it on the mid bench; a timber pier reaches into the foreground water.
 *
 * Heights: water surface 0.5 · wet-sand skirt 1 · beach 2 · low bench 3 ·
 * mid bench 4 · crag top 8 · tower 10..24 · lantern 26..28 · dome cap 31.
 */

// ── palette ─────────────────────────────────────────────────────────────────
const SAND = 0xd9b27e; // dry beach shelf
const SAND_WET = 0xbf9460; // waterline skirt + underpinning
const ROCK_BENCH = 0x8d8270; // low rock bench
const ROCK_MID = 0x776c5b; // mid bench (cottage terrace)
const CRAG = 0x5f574b; // crag cliff walls
const CRAG_TOP = 0x6e6456; // crag cap, sun-warmed
const CREAM = 0xf1e6cf; // tower + cottage plaster
const CORAL = 0xcd5f49; // tower bands + shutters
const STONE = 0x9b948a; // tower plinth
const STONE_DARK = 0x6f6a62; // chimney
const SLATE = 0x49505a; // roofs + gallery deck
const WOOD_DARK = 0x6b4226; // posts, hull, timberwork
const WOOD_LIGHT = 0x96693f; // pier planking, bilge
const IRON = 0x9aa3ad; // gallery railing, mullions
const IRON_DARK = 0x76808c; // lantern dome
const GLASS = 0xcfe9ea; // lantern glazing + cottage windows
const LAMP = 0xffdf9e; // warm beacon glow
const WATER_DEEP = 0x2a5f6d;
const WATER_SHALLOW = 0x3e8390;

// ── shared form helpers ──────────────────────────────────────────────────────

/** Full hip ring at `y`: 4 ramp runs + 4 corner wedges, interior filled solid. */
const hipRing = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  cls: number,
  rgb: number,
): void => {
  ctx.set(x0, y, z0, cls, rgb, SHAPE_CORNER_PXPZ);
  ctx.set(x1, y, z0, cls, rgb, SHAPE_CORNER_NXPZ);
  ctx.set(x1, y, z1, cls, rgb, SHAPE_CORNER_NXNZ);
  ctx.set(x0, y, z1, cls, rgb, SHAPE_CORNER_PXNZ);
  if (x1 - x0 >= 2) {
    ctx.box(x0 + 1, y, z0, x1 - 1, y, z0, cls, rgb, SHAPE_RAMP_PZ);
    ctx.box(x0 + 1, y, z1, x1 - 1, y, z1, cls, rgb, SHAPE_RAMP_NZ);
  }
  if (z1 - z0 >= 2) {
    ctx.box(x0, y, z0 + 1, x0, y, z1 - 1, cls, rgb, SHAPE_RAMP_PX);
    ctx.box(x1, y, z0 + 1, x1, y, z1 - 1, cls, rgb, SHAPE_RAMP_NX);
  }
  if (x1 - x0 >= 2 && z1 - z0 >= 2) {
    ctx.box(x0 + 1, y, z0 + 1, x1 - 1, y, z1 - 1, cls, rgb);
  }
};

/**
 * One terrace step-down for the headland (anchored to x=0 / z=95): a complete
 * ramp run along the whole east contour (x=xEast), another along the whole
 * south contour (z=zSouth), and the corner wedge where they meet.
 */
const contourStep = (ctx: SceneCtx, xEast: number, zSouth: number, y: number, rgb: number) => {
  ctx.box(xEast, y, zSouth + 1, xEast, y, 95, MaterialClass.Matte, rgb, SHAPE_RAMP_NX);
  ctx.box(0, y, zSouth, xEast - 1, y, zSouth, MaterialClass.Matte, rgb, SHAPE_RAMP_PZ);
  ctx.set(xEast, y, zSouth, MaterialClass.Matte, rgb, SHAPE_CORNER_NXPZ);
};

/** Octagonal disc layer; `half` is the half-width per |dz| row. */
const octDisc = (
  ctx: SceneCtx,
  cx: number,
  cz: number,
  y: number,
  half: readonly number[],
  cls: number,
  rgb: number,
): void => {
  const r = half.length - 1;
  for (let dz = -r; dz <= r; dz++) {
    const w = half[Math.abs(dz)];
    ctx.box(cx - w, y, cz + dz, cx + w, y, cz + dz, cls, rgb);
  }
};

const OCT3 = [3, 3, 2, 1] as const; // radius-3 tower drum
const OCT4 = [4, 4, 3, 2, 1] as const; // radius-4 plinth

/** Small 2×2 beach boulder: cube base capped by a complete corner-wedge ring. */
const boulder = (ctx: SceneCtx, x: number, z: number, y: number, rgb: number): void => {
  ctx.box(x, y, z, x + 1, y, z + 1, MaterialClass.Matte, rgb);
  ctx.set(x, y + 1, z, MaterialClass.Matte, rgb, SHAPE_CORNER_PXPZ);
  ctx.set(x + 1, y + 1, z, MaterialClass.Matte, rgb, SHAPE_CORNER_NXPZ);
  ctx.set(x + 1, y + 1, z + 1, MaterialClass.Matte, rgb, SHAPE_CORNER_NXNZ);
  ctx.set(x, y + 1, z + 1, MaterialClass.Matte, rgb, SHAPE_CORNER_PXNZ);
};

// ── 1. sea — calm slab sheet, two tones in clean offset bands ───────────────

const buildSea = (ctx: SceneCtx): void => {
  // Land claims x<=31 & z>=23; everything else is water (bottom slab, top at 0.5).
  // Shallow band hugs the headland as a 3-cell offset contour, deep water beyond.
  ctx.box(32, 0, 23, 34, 0, 95, CLS_WATER, WATER_SHALLOW, SHAPE_SLAB_BOTTOM);
  ctx.box(0, 0, 20, 34, 0, 22, CLS_WATER, WATER_SHALLOW, SHAPE_SLAB_BOTTOM);
  ctx.box(35, 0, 20, 95, 0, 95, CLS_WATER, WATER_DEEP, SHAPE_SLAB_BOTTOM);
  ctx.box(0, 0, 0, 95, 0, 19, CLS_WATER, WATER_DEEP, SHAPE_SLAB_BOTTOM);
};

// ── 2. headland — terraced rock, complete contour runs into the sea ─────────

const buildHeadland = (ctx: SceneCtx): void => {
  // Wet-sand skirt: solid edging one level below the beach rim, flush at the
  // waterline, plus underpinning beneath the beach edge and its ramp run.
  ctx.box(31, 0, 23, 31, 0, 95, MaterialClass.Matte, SAND_WET);
  ctx.box(0, 0, 23, 30, 0, 23, MaterialClass.Matte, SAND_WET);
  ctx.box(0, 0, 24, 30, 0, 25, MaterialClass.Matte, SAND_WET);
  ctx.box(29, 0, 26, 30, 0, 95, MaterialClass.Matte, SAND_WET);

  // Beach shelf (surface y=2) with its full ramp contour down to the water.
  ctx.box(0, 1, 25, 29, 1, 95, MaterialClass.Matte, SAND);
  contourStep(ctx, 30, 24, 1, SAND);

  // Low rock bench (surface y=3).
  ctx.box(0, 2, 33, 24, 2, 95, MaterialClass.Matte, ROCK_BENCH);
  contourStep(ctx, 25, 32, 2, ROCK_BENCH);

  // Mid bench — the cottage terrace (surface y=4).
  ctx.box(0, 3, 39, 19, 3, 95, MaterialClass.Matte, ROCK_MID);
  contourStep(ctx, 20, 38, 3, ROCK_MID);

  // Lighthouse crag: deliberate crisp square cliffs, sun-warmed cap (surface y=8).
  ctx.box(0, 4, 46, 14, 6, 84, MaterialClass.Matte, CRAG);
  ctx.box(0, 7, 46, 14, 7, 84, MaterialClass.Matte, CRAG_TOP);

  // Beach boulders — sparse, deliberate accents on the sand.
  boulder(ctx, 12, 27, 2, ROCK_MID);
  boulder(ctx, 21, 30, 2, ROCK_BENCH);
};

// ── 3. lighthouse — striped drum, iron gallery, glazed lantern, domed cap ───

const TOWER_X = 7;
const TOWER_Z = 64;

const buildLighthouse = (ctx: SceneCtx): void => {
  // Stone plinth on the crag cap.
  for (let y = 8; y <= 9; y++) octDisc(ctx, TOWER_X, TOWER_Z, y, OCT4, MaterialClass.Matte, STONE);

  // Drum: alternating cream/coral daymark bands, three courses each.
  for (let y = 10; y <= 24; y++) {
    const band = Math.floor((y - 10) / 3) % 2 === 0 ? CREAM : CORAL;
    octDisc(ctx, TOWER_X, TOWER_Z, y, OCT3, MaterialClass.Matte, band);
  }

  // Gallery deck and its iron railing — a purposeful panel ring, all four runs.
  const [gx0, gx1, gz0, gz1] = [TOWER_X - 3, TOWER_X + 3, TOWER_Z - 3, TOWER_Z + 3];
  ctx.box(gx0, 25, gz0, gx1, 25, gz1, MaterialClass.Matte, SLATE);
  ctx.box(gx0, 26, gz0, gx1, 26, gz0, CLS_METAL, IRON, SHAPE_VSLAB_NZ);
  ctx.box(gx0, 26, gz1, gx1, 26, gz1, CLS_METAL, IRON, SHAPE_VSLAB_PZ);
  ctx.box(gx0, 26, gz0 + 1, gx0, 26, gz1 - 1, CLS_METAL, IRON, SHAPE_VSLAB_NX);
  ctx.box(gx1, 26, gz0 + 1, gx1, 26, gz1 - 1, CLS_METAL, IRON, SHAPE_VSLAB_PX);

  // Lantern room: metal corner mullions, glazed faces, warm beacon core.
  for (let y = 26; y <= 28; y++) {
    ctx.set(TOWER_X - 1, y, TOWER_Z - 1, CLS_METAL, IRON);
    ctx.set(TOWER_X + 1, y, TOWER_Z - 1, CLS_METAL, IRON);
    ctx.set(TOWER_X + 1, y, TOWER_Z + 1, CLS_METAL, IRON);
    ctx.set(TOWER_X - 1, y, TOWER_Z + 1, CLS_METAL, IRON);
    ctx.set(TOWER_X, y, TOWER_Z - 1, MaterialClass.Glass, GLASS);
    ctx.set(TOWER_X, y, TOWER_Z + 1, MaterialClass.Glass, GLASS);
    ctx.set(TOWER_X - 1, y, TOWER_Z, MaterialClass.Glass, GLASS);
    ctx.set(TOWER_X + 1, y, TOWER_Z, MaterialClass.Glass, GLASS);
    ctx.set(TOWER_X, y, TOWER_Z, MaterialClass.Emissive, LAMP);
  }

  // Dome: two full hip rings closing to a slab cap.
  hipRing(ctx, TOWER_X - 2, TOWER_Z - 2, TOWER_X + 2, TOWER_Z + 2, 29, CLS_METAL, IRON_DARK);
  hipRing(ctx, TOWER_X - 1, TOWER_Z - 1, TOWER_X + 1, TOWER_Z + 1, 30, CLS_METAL, IRON_DARK);
  ctx.set(TOWER_X, 31, TOWER_Z, CLS_METAL, IRON_DARK, SHAPE_SLAB_BOTTOM);
};

// ── 4. keeper's cottage — plaster walls, framed door, shuttered windows ─────

const buildCottage = (ctx: SceneCtx): void => {
  // Shell on the mid bench, nestled against the crag's south face. Walls 4 high,
  // dark timber posts pinning each corner.
  ctx.box(6, 4, 40, 13, 7, 45, MaterialClass.Matte, CREAM);
  for (const [px, pz] of [
    [6, 40],
    [13, 40],
    [13, 45],
    [6, 45],
  ] as const) {
    ctx.box(px, 4, pz, px, 7, pz, MaterialClass.Matte, WOOD_DARK);
  }

  // Door on the east gable (facing the camera), carved then timber-framed.
  ctx.clear(13, 4, 42);
  ctx.clear(13, 5, 42);
  ctx.box(13, 4, 41, 13, 5, 41, MaterialClass.Matte, WOOD_DARK);
  ctx.box(13, 4, 43, 13, 5, 43, MaterialClass.Matte, WOOD_DARK);
  ctx.set(13, 6, 42, MaterialClass.Matte, WOOD_DARK);

  // South-wall windows, each flanked by a pair of coral VSLAB shutters.
  for (const wx of [8, 11] as const) {
    ctx.box(wx, 5, 40, wx, 6, 40, MaterialClass.Glass, GLASS);
    ctx.box(wx - 1, 5, 39, wx - 1, 6, 39, MaterialClass.Matte, CORAL, SHAPE_VSLAB_PZ);
    ctx.box(wx + 1, 5, 39, wx + 1, 6, 39, MaterialClass.Matte, CORAL, SHAPE_VSLAB_PZ);
  }

  // Full hipped roof: four stacked hip rings closing on a 4×2 ridge cap,
  // one-block eaves all round.
  hipRing(ctx, 5, 39, 14, 46, 8, MaterialClass.Matte, SLATE);
  hipRing(ctx, 6, 40, 13, 45, 9, MaterialClass.Matte, SLATE);
  hipRing(ctx, 7, 41, 12, 44, 10, MaterialClass.Matte, SLATE);
  hipRing(ctx, 8, 42, 11, 43, 11, MaterialClass.Matte, SLATE);

  // Stone chimney punching through the roof slope.
  ctx.box(7, 8, 41, 7, 12, 41, MaterialClass.Matte, STONE_DARK);
  ctx.set(7, 13, 41, MaterialClass.Matte, STONE, SHAPE_SLAB_BOTTOM);
};

// ── 5. timber pier — plank deck on posts, railing run, lamp at the head ─────

const buildPier = (ctx: SceneCtx): void => {
  // Plank deck reaching east off the beach, half a block proud of the sand.
  ctx.box(31, 2, 60, 54, 2, 62, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_BOTTOM);

  // Post pairs marching down both edges into the water.
  for (let px = 34; px <= 54; px += 4) {
    ctx.box(px, 0, 60, px, 1, 60, MaterialClass.Matte, WOOD_DARK);
    ctx.box(px, 0, 62, px, 1, 62, MaterialClass.Matte, WOOD_DARK);
  }

  // Continuous VSLAB railing run along the far (north) edge of the deck.
  ctx.box(31, 3, 62, 53, 3, 62, MaterialClass.Matte, WOOD_DARK, SHAPE_VSLAB_PZ);

  // Pier-head lamp post and a squat iron mooring bollard.
  ctx.box(54, 3, 62, 54, 4, 62, MaterialClass.Matte, WOOD_DARK);
  ctx.set(54, 5, 62, MaterialClass.Emissive, LAMP);
  ctx.set(54, 6, 62, CLS_METAL, IRON_DARK, SHAPE_SLAB_BOTTOM);
  ctx.set(54, 3, 60, CLS_METAL, IRON_DARK);
};

// ── 6. rowboat — moored off the pier's south flank, half-sunk at the line ───

const buildRowboat = (ctx: SceneCtx): void => {
  // Hull walls and square transom sit in the water cell, waterline at mid-hull.
  ctx.box(50, 0, 56, 53, 0, 56, MaterialClass.Matte, WOOD_DARK);
  ctx.box(50, 0, 58, 53, 0, 58, MaterialClass.Matte, WOOD_DARK);
  ctx.box(49, 0, 56, 49, 0, 58, MaterialClass.Matte, WOOD_DARK);

  // Bow: one complete ramp run across the boat's whole width.
  ctx.box(54, 0, 56, 54, 0, 58, MaterialClass.Matte, WOOD_DARK, SHAPE_RAMP_NX);

  // Bilge boards and a single thwart bench.
  ctx.box(50, 0, 57, 51, 0, 57, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.set(53, 0, 57, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.set(52, 0, 57, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_TOP);
};

// ── scene ────────────────────────────────────────────────────────────────────

export const scene: SceneSpec = {
  id: "harbor-lighthouse",
  name: "Harbor Lighthouse",
  blurb: "striped beacon over a rocky cove",
  cx: 3,
  cy: 2,
  cz: 3,
  build(ctx: SceneCtx): void {
    buildSea(ctx);
    buildHeadland(ctx);
    buildLighthouse(ctx);
    buildCottage(ctx);
    buildPier(ctx);
    buildRowboat(ctx);
  },
};
