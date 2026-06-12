/**
 * Sky Temple — a floating island shrine composed as one silhouette: an
 * inverted rock cone hanging in the sky, a calm lawn on top, and a two-tier
 * pagoda rising slightly off-centre. The hero camera looks from the east
 * (azimuth -0.65 rad, ~33° up), so the reflecting basin and its waterfall
 * spill over the EAST rim toward the viewer, the torii approach crosses the
 * lawn behind it, and the pagoda stands tall against the sky.
 *
 * Form notes:
 * - The underbelly tapers with complete wedge rings: every taper level is a
 *   full ring (4 ramp runs + 4 corner wedges) wrapped around a solid core,
 *   alternating with crisp square cliff bands. All rings derive from one
 *   hand-written profile table, so slope continuity holds by construction —
 *   each ring's low inner edge meets the next band's top edge exactly.
 * - Both pagoda roofs are full hip rings over timber beam rings; eaves are
 *   unbroken slab-top rings with two-slab corner kicks.
 * - Every VSLAB lives in a cluster: shoji screens between posts, the veranda
 *   balustrade ring, and the waterfall sheet.
 */
import type { SceneCtx, SceneSpec } from "../scene";
import {
  CLS_METAL,
  CLS_PLASMA,
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

// ---------------------------------------------------------------------------
// Palette — three value tiers inside every material area.

const GRASS_BRIGHT = 0x6fae54;
const GRASS_MID = 0x4f8a4c;
const GRASS_DARK = 0x3a6b42;
const SOIL = 0x6b4f33;
const ROCK_LIGHT = 0x7a7268;
const ROCK_MID = 0x5d574f;
const ROCK_DARK = 0x423d38;
const STONE = 0x9aa0a8;
const STONE_DARK = 0x70767e;
const TIMBER = 0x4a3527;
const CREAM = 0xe8e0cf;
const SHOJI = 0xf5efe2;
const TORII_RED = 0xc23b2e;
const ROOF_SLATE = 0x3a4654;
const ROOF_EAVE = 0x2c343f;
const ROOF_RIDGE = 0x5b6c80;
const GOLD = 0xd8b04a;
const WATER = 0x3f7fae;
const WATER_DEEP = 0x2c5d85;
const FOAM = 0xcfe9f4;
const CLOUD_LIGHT = 0xc9cdd4;
const CLOUD_SHADE = 0xaab0b9;
const LANTERN = 0xffd9a0;
const PLASMA = 0x9fe8ff;

const { Matte, Gloss, Emissive } = MaterialClass;

// ---------------------------------------------------------------------------
// Layout anchors.

/** Island centre; the lawn rectangle is ICX±16 by ICZ±17. */
const ICX = 45;
const ICZ = 49;
/** Grass cap layer; everything on the lawn stands from LAWN_Y + 1. */
const LAWN_Y = 24;
const DECK = LAWN_Y + 1;

// ---------------------------------------------------------------------------
// Ring helpers — always full rings, never lone wedges.

/** Wedge ring sloping up toward the OUTSIDE of the rect (island taper). */
const taperRing = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  rgb: number,
): void => {
  for (let x = x0 + 1; x < x1; x++) {
    ctx.set(x, y, z0, Matte, rgb, SHAPE_RAMP_NZ);
    ctx.set(x, y, z1, Matte, rgb, SHAPE_RAMP_PZ);
  }
  for (let z = z0 + 1; z < z1; z++) {
    ctx.set(x0, y, z, Matte, rgb, SHAPE_RAMP_NX);
    ctx.set(x1, y, z, Matte, rgb, SHAPE_RAMP_PX);
  }
  ctx.set(x0, y, z0, Matte, rgb, SHAPE_CORNER_NXNZ);
  ctx.set(x1, y, z0, Matte, rgb, SHAPE_CORNER_PXNZ);
  ctx.set(x0, y, z1, Matte, rgb, SHAPE_CORNER_NXPZ);
  ctx.set(x1, y, z1, Matte, rgb, SHAPE_CORNER_PXPZ);
};

/** Wedge ring sloping up toward the INSIDE of the rect (roof hips). */
const hipRing = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  rgb: number,
): void => {
  for (let x = x0 + 1; x < x1; x++) {
    ctx.set(x, y, z0, Gloss, rgb, SHAPE_RAMP_PZ);
    ctx.set(x, y, z1, Gloss, rgb, SHAPE_RAMP_NZ);
  }
  for (let z = z0 + 1; z < z1; z++) {
    ctx.set(x0, y, z, Gloss, rgb, SHAPE_RAMP_PX);
    ctx.set(x1, y, z, Gloss, rgb, SHAPE_RAMP_NX);
  }
  ctx.set(x0, y, z0, Gloss, rgb, SHAPE_CORNER_PXPZ);
  ctx.set(x1, y, z0, Gloss, rgb, SHAPE_CORNER_NXPZ);
  ctx.set(x0, y, z1, Gloss, rgb, SHAPE_CORNER_PXNZ);
  ctx.set(x1, y, z1, Gloss, rgb, SHAPE_CORNER_NXNZ);
};

/** One-voxel-tall perimeter rectangle (beam rings, eave rings, stone rims). */
const rimRing = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  cls: number,
  rgb: number,
  shape?: number,
): void => {
  ctx.box(x0, y, z0, x1, y, z0, cls, rgb, shape);
  ctx.box(x0, y, z1, x1, y, z1, cls, rgb, shape);
  ctx.box(x0, y, z0, x0, y, z1, cls, rgb, shape);
  ctx.box(x1, y, z0, x1, y, z1, cls, rgb, shape);
};

/** Hollow wall box (interior never shows; saves voxels). */
const wallShell = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  rgb: number,
): void => {
  ctx.box(x0, y0, z0, x1, y1, z0, Matte, rgb);
  ctx.box(x0, y0, z1, x1, y1, z1, Matte, rgb);
  ctx.box(x0, y0, z0, x0, y1, z1, Matte, rgb);
  ctx.box(x1, y0, z0, x1, y1, z1, Matte, rgb);
};

/** Unbroken slab-top eave ring with a two-slab kick outside each corner. */
const eaveRing = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
): void => {
  rimRing(ctx, x0, z0, x1, z1, y, Gloss, ROOF_EAVE, SHAPE_SLAB_TOP);
  for (const [cx, cz, dx, dz] of [
    [x0, z0, -1, -1],
    [x1, z0, 1, -1],
    [x0, z1, -1, 1],
    [x1, z1, 1, 1],
  ] as const) {
    ctx.set(cx + dx, y, cz, Gloss, ROOF_EAVE, SHAPE_SLAB_TOP);
    ctx.set(cx, y, cz + dz, Gloss, ROOF_EAVE, SHAPE_SLAB_TOP);
  }
};

// ---------------------------------------------------------------------------
// Island — a chunky inverted cone, ~11 voxels deep below the lawn. `half` is
// the x half-extent (z extent is half+1). Taper bands carry a full outward
// wedge ring around a solid core; square bands are crisp cliff rims inset by
// 2-3 cells, so the stepped strata silhouette reads from the hero camera.

interface RockBand {
  y: number;
  half: number;
  taper: boolean;
}

const ROCK_PROFILE: RockBand[] = [
  { y: 23, half: 16, taper: false }, // soil band under the lawn
  { y: 22, half: 16, taper: true },
  { y: 21, half: 13, taper: false }, // cliff shelf
  { y: 20, half: 13, taper: true },
  { y: 19, half: 9, taper: false }, // cliff shelf
  { y: 18, half: 9, taper: true },
  { y: 17, half: 5, taper: false }, // cliff shelf
  { y: 16, half: 5, taper: true },
  { y: 15, half: 2, taper: false }, // cliff shelf
  { y: 14, half: 2, taper: true },
];

/** Broad rock value bands, breaking exactly on cliff rims. */
const rockColor = (y: number): number => {
  if (y === 23) return SOIL;
  if (y >= 21) return ROCK_LIGHT;
  if (y >= 18) return ROCK_MID;
  return ROCK_DARK;
};

const buildIsland = (ctx: SceneCtx): void => {
  for (const band of ROCK_PROFILE) {
    const rgb = rockColor(band.y);
    const x0 = ICX - band.half;
    const x1 = ICX + band.half;
    const z0 = ICZ - band.half - 1;
    const z1 = ICZ + band.half + 1;
    if (band.taper) {
      ctx.box(x0 + 1, band.y, z0 + 1, x1 - 1, band.y, z1 - 1, Matte, rgb);
      taperRing(ctx, x0, z0, x1, z1, band.y, rgb);
    } else {
      ctx.box(x0, band.y, z0, x1, band.y, z1, Matte, rgb);
    }
  }
  // Hanging tip under the last ring's solid core.
  ctx.set(ICX, 13, ICZ, Matte, ROCK_DARK, SHAPE_SLAB_TOP);
};

// ---------------------------------------------------------------------------
// Lawn — broad value zones (dark rim, bright meadows), never per-voxel noise.

const buildLawn = (ctx: SceneCtx): void => {
  ctx.box(29, LAWN_Y, 32, 61, LAWN_Y, 66, Matte, GRASS_MID);
  rimRing(ctx, 29, 32, 61, 66, LAWN_Y, Matte, GRASS_DARK);
  ctx.box(33, LAWN_Y, 40, 40, LAWN_Y, 46, Matte, GRASS_BRIGHT);
  ctx.box(50, LAWN_Y, 57, 57, LAWN_Y, 62, Matte, GRASS_BRIGHT);
  ctx.box(55, LAWN_Y, 34, 60, LAWN_Y, 39, Matte, GRASS_DARK);
};

// ---------------------------------------------------------------------------
// Approach — slab path from the west rim to the pagoda plinth, banded stone.

const buildPath = (ctx: SceneCtx): void => {
  ctx.box(32, DECK, 47, 42, DECK, 47, Matte, STONE_DARK, SHAPE_SLAB_BOTTOM);
  ctx.box(32, DECK, 48, 42, DECK, 48, Matte, STONE, SHAPE_SLAB_BOTTOM);
  ctx.box(32, DECK, 49, 42, DECK, 49, Matte, STONE_DARK, SHAPE_SLAB_BOTTOM);
};

/** Vermilion torii straddling the path mouth; paired ramp kicks on the cap. */
const buildTorii = (ctx: SceneCtx): void => {
  ctx.box(34, DECK, 46, 34, 30, 46, Matte, TORII_RED);
  ctx.box(34, DECK, 50, 34, 30, 50, Matte, TORII_RED);
  ctx.box(34, 29, 45, 34, 29, 51, Matte, TORII_RED); // nuki tie beam
  ctx.set(34, 30, 48, Matte, TORII_RED); // gakuzuka centre strut
  ctx.box(34, 31, 44, 34, 31, 52, Matte, TORII_RED); // kasagi beam
  ctx.box(34, 32, 45, 34, 32, 51, Gloss, ROOF_EAVE, SHAPE_SLAB_BOTTOM);
  ctx.set(34, 32, 44, Gloss, ROOF_EAVE, SHAPE_RAMP_NZ); // deliberate paired
  ctx.set(34, 32, 52, Gloss, ROOF_EAVE, SHAPE_RAMP_PZ); // end kicks
};

/** Stone lantern pair flanking the path — the only lawn-level glows. */
const buildLanterns = (ctx: SceneCtx): void => {
  for (const z of [45, 51]) {
    ctx.set(39, DECK, z, Matte, STONE_DARK);
    ctx.set(39, 26, z, Matte, STONE);
    ctx.set(39, 27, z, Emissive, LANTERN);
    ctx.set(39, 28, z, Matte, STONE_DARK, SHAPE_SLAB_BOTTOM);
  }
};

// ---------------------------------------------------------------------------
// Pagoda — stone plinth, two cream-walled tiers with timber posts and beam
// rings, shoji VSLAB clusters on the camera faces, full hip-ring roofs.

const buildPagoda = (ctx: SceneCtx): void => {
  // Plinth with a light stone border and a 2-cell veranda ledge.
  ctx.box(44, DECK, 42, 56, DECK, 54, Matte, STONE_DARK);
  rimRing(ctx, 43, 41, 57, 55, DECK, Matte, STONE);

  // Tier 1 walls (y26..29) + timber posts + beam ring at y30.
  wallShell(ctx, 45, 43, 55, 53, 26, 29, CREAM);
  for (const [px, pz] of [
    [45, 43],
    [50, 43],
    [55, 43],
    [45, 53],
    [50, 53],
    [55, 53],
    [55, 48],
    [45, 46],
    [45, 50],
  ] as const) {
    ctx.box(px, 26, pz, px, 29, pz, Matte, TIMBER);
  }
  rimRing(ctx, 45, 43, 55, 53, 30, Matte, TIMBER);

  // Framed door on the west face, opening toward the torii.
  for (let y = 26; y <= 28; y++) {
    for (let z = 47; z <= 49; z++) ctx.clear(45, y, z);
  }

  // Altar glint visible through the doorway.
  ctx.set(50, 26, 48, Matte, STONE_DARK);
  ctx.set(50, 27, 48, CLS_METAL, GOLD);

  // Shoji screen clusters between posts (south + west camera faces).
  ctx.box(46, 26, 54, 49, 28, 54, Matte, SHOJI, SHAPE_VSLAB_NZ);
  ctx.box(51, 26, 54, 54, 28, 54, Matte, SHOJI, SHAPE_VSLAB_NZ);
  ctx.box(44, 26, 44, 44, 28, 45, Matte, SHOJI, SHAPE_VSLAB_PX);
  ctx.box(44, 26, 51, 44, 28, 52, Matte, SHOJI, SHAPE_VSLAB_PX);

  // Hanging lanterns flanking the door, timber brackets above.
  for (const z of [46, 50]) {
    ctx.set(44, 28, z, Emissive, LANTERN);
    ctx.set(44, 29, z, Matte, TIMBER, SHAPE_SLAB_TOP);
  }

  // Tier 1 roof: eave ring, hip ring, slate deck for tier 2.
  eaveRing(ctx, 44, 42, 56, 54, 30);
  ctx.box(45, 31, 43, 55, 31, 53, Gloss, ROOF_SLATE);
  hipRing(ctx, 45, 43, 55, 53, 31, ROOF_SLATE);

  // Veranda balustrade ring on the tier-1 deck edge — vermilion panels
  // between timber corner posts (all four VSLAB orientations, full ring).
  ctx.box(47, 32, 44, 53, 32, 44, Matte, TORII_RED, SHAPE_VSLAB_NZ);
  ctx.box(47, 32, 52, 53, 32, 52, Matte, TORII_RED, SHAPE_VSLAB_PZ);
  ctx.box(46, 32, 45, 46, 32, 51, Matte, TORII_RED, SHAPE_VSLAB_NX);
  ctx.box(54, 32, 45, 54, 32, 51, Matte, TORII_RED, SHAPE_VSLAB_PX);
  for (const [bx, bz] of [
    [46, 44],
    [54, 44],
    [46, 52],
    [54, 52],
  ] as const) {
    ctx.set(bx, 32, bz, Matte, TIMBER);
  }

  // Tier 2 walls (y32..35) + posts + beam ring at y36.
  wallShell(ctx, 47, 45, 53, 51, 32, 35, CREAM);
  for (const [px, pz] of [
    [47, 45],
    [50, 45],
    [53, 45],
    [47, 51],
    [50, 51],
    [53, 51],
    [47, 48],
    [53, 48],
  ] as const) {
    ctx.box(px, 32, pz, px, 35, pz, Matte, TIMBER);
  }
  rimRing(ctx, 47, 45, 53, 51, 36, Matte, TIMBER);

  // Tier 2 shoji clusters.
  ctx.box(48, 32, 52, 49, 34, 52, Matte, SHOJI, SHAPE_VSLAB_NZ);
  ctx.box(51, 32, 52, 52, 34, 52, Matte, SHOJI, SHAPE_VSLAB_NZ);
  ctx.box(46, 32, 46, 46, 34, 47, Matte, SHOJI, SHAPE_VSLAB_PX);
  ctx.box(46, 32, 49, 46, 34, 50, Matte, SHOJI, SHAPE_VSLAB_PX);

  // Tier 2 roof: eave ring, then hip rings closing to the ridge.
  eaveRing(ctx, 46, 44, 54, 52, 36);
  ctx.box(47, 37, 45, 53, 37, 51, Gloss, ROOF_SLATE);
  hipRing(ctx, 47, 45, 53, 51, 37, ROOF_SLATE);
  ctx.box(48, 38, 46, 52, 38, 50, Gloss, ROOF_SLATE);
  hipRing(ctx, 48, 46, 52, 50, 38, ROOF_SLATE);
  ctx.box(49, 39, 47, 51, 39, 49, Gloss, ROOF_RIDGE);
  hipRing(ctx, 49, 47, 51, 49, 39, ROOF_RIDGE);

  // Gold finial at the apex.
  ctx.set(50, 40, 48, CLS_METAL, GOLD);
  ctx.set(50, 41, 48, CLS_METAL, GOLD, SHAPE_SLAB_BOTTOM);
};

// ---------------------------------------------------------------------------
// Water — stone-rimmed basin one level above the lawn, water one level below
// the rim top, a channel east to the rim, and a VSLAB sheet falling off the
// camera-facing east face into mist.

const buildBasinAndFalls = (ctx: SceneCtx): void => {
  // Basin rim with a gap on the east side where the channel leaves.
  rimRing(ctx, 52, 56, 58, 62, DECK, Matte, STONE);
  for (const [cx, cz] of [
    [52, 56],
    [58, 56],
    [52, 62],
    [58, 62],
  ] as const) {
    ctx.set(cx, DECK, cz, Matte, STONE_DARK);
  }
  for (let z = 58; z <= 60; z++) ctx.clear(58, DECK, z);

  // Pool, deep centre, and the outbound channel cut into the lawn.
  ctx.box(53, LAWN_Y, 57, 57, LAWN_Y, 61, CLS_WATER, WATER);
  ctx.box(54, LAWN_Y, 58, 56, LAWN_Y, 60, CLS_WATER, WATER_DEEP);
  ctx.box(58, LAWN_Y, 58, 61, LAWN_Y, 60, CLS_WATER, WATER);
  ctx.box(59, DECK, 57, 61, DECK, 57, Matte, STONE_DARK);
  ctx.box(59, DECK, 61, 61, DECK, 61, Matte, STONE_DARK);

  // Waterfall sheet hugging the east face: foam centre, water edges.
  for (let y = 14; y <= LAWN_Y; y++) {
    ctx.set(62, y, 58, CLS_WATER, y === 14 ? FOAM : WATER, SHAPE_VSLAB_NX);
    ctx.set(62, y, 59, CLS_WATER, FOAM, SHAPE_VSLAB_NX);
    ctx.set(62, y, 60, CLS_WATER, y === 14 ? FOAM : WATER, SHAPE_VSLAB_NX);
  }

  // Mist puffs below the lip.
  ctx.box(59, 13, 57, 62, 13, 61, Matte, CLOUD_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.box(60, 12, 58, 61, 12, 60, Matte, CLOUD_SHADE, SHAPE_SLAB_TOP);
};

/** The shrine orb — a single rounded plasma flame floating over the basin. */
const buildShrineOrb = (ctx: SceneCtx): void => {
  ctx.set(55, 27, 59, CLS_PLASMA, PLASMA, SHAPE_SLAB_TOP);
  ctx.set(55, 28, 59, CLS_PLASMA, PLASMA);
  ctx.set(55, 29, 59, CLS_PLASMA, FOAM, SHAPE_SLAB_BOTTOM);
};

// ---------------------------------------------------------------------------
// Clouds — three puffs drifting past the cone, kept inside the island's
// horizontal bounds, slab-softened top and bottom. Matte soft greys: a light
// crown over a shaded belly, so they never read as emissive blooms.

const cloudPuff = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
): void => {
  ctx.box(x0, y, z0, x1, y, z1, Matte, CLOUD_LIGHT);
  ctx.box(x0 + 1, y + 1, z0 + 1, x1 - 1, y + 1, z1 - 1, Matte, CLOUD_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.box(x0 + 1, y - 1, z0 + 1, x1 - 1, y - 1, z1 - 1, Matte, CLOUD_SHADE, SHAPE_SLAB_TOP);
};

const buildClouds = (ctx: SceneCtx): void => {
  cloudPuff(ctx, 29, 37, 34, 43, 13); // west, mid-height
  cloudPuff(ctx, 54, 52, 60, 58, 10); // south-east, low
  cloudPuff(ctx, 58, 39, 61, 43, 16); // north-east, small and high
};

// ---------------------------------------------------------------------------

const build = (ctx: SceneCtx): void => {
  buildIsland(ctx);
  buildLawn(ctx);

  buildPath(ctx);
  buildTorii(ctx);
  buildLanterns(ctx);

  buildPagoda(ctx);

  buildBasinAndFalls(ctx);
  buildShrineOrb(ctx);

  buildClouds(ctx);
};

export const scene: SceneSpec = {
  id: "sky-temple",
  name: "Sky Temple",
  blurb: "floating shrine above the clouds",
  cx: 3,
  cy: 2,
  cz: 3,
  build,
};
