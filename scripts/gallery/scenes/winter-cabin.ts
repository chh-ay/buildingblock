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
  SHAPE_VSLAB_NX,
  SHAPE_VSLAB_NZ,
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
} from "../scene";

/**
 * Winter Cabin — a log cabin at dusk in fresh snow.
 *
 * Hero camera sits at +X / -Z, ~33° up. Layout for that shot:
 *   - cabin mass slightly off-center (x31..44, z45..54), door + windows on the
 *     +X and -Z faces so the warm glow reads;
 *   - tall snow-dusted pines behind on a raised drift plateau (low X / high Z);
 *   - calm foreground: frozen pond (high X / low Z), shoveled path, low drifts;
 *   - VSLAB plank fence with a gate and a lantern post framing the yard.
 */

// ── palette ───────────────────────────────────────────────────────────────────

const SNOW_BRIGHT = 0xe6e9f2; // fresh drifts, upper roof, pine caps
const SNOW = 0xd4dcec; // ground field, apron, lower roof
const SNOW_SHADE = 0xc2cde2; // eave overhang slabs (in shadow)
const PATH = 0xb0bdd6; // trodden snow

const LOG_LIGHT = 0x8a6342; // log course A
const LOG_DARK = 0x6e4c2f; // log course B
const WOOD_DARK = 0x4b3320; // corner posts, frames, door, fence posts
const FENCE = 0x9c7b53; // weathered plank panels, bench

const PINE = 0x2e5a39;
const PINE_DARK = 0x234630;
const PINE_FROST = 0x87ad91; // snow-dusted top tier

const BRICK = 0x8d5040;
const BRICK_DARK = 0x6f3a2d;
const STONE = 0x99a1ab; // pond coping
const STONE_DARK = 0x79818c; // chimney cap

const ICE = 0xbfe0f2; // glass sheet
const WATER = 0x3c6e95;
const GLOW = 0xffc070; // window panes
const LANTERN = 0xffd79a;
const METAL = 0x5a6470;
const SMOKE = 0xd3d8de;

const M = MaterialClass.Matte;

// ── shape helpers ─────────────────────────────────────────────────────────────

/**
 * One closed hip ring on the boundary of an inclusive rect: four ramp runs
 * rising inward plus four outer corner wedges. Works for roof storeys, drift
 * aprons, snow lenses and pine canopy tiers. Rect must be at least 2×2.
 */
const hipRing = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  rgb: number,
): void => {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const w = x === x0;
      const e = x === x1;
      const n = z === z0;
      const s = z === z1;
      if (!w && !e && !n && !s) continue;
      let shape: number;
      if (w && n) shape = SHAPE_CORNER_PXPZ;
      else if (e && n) shape = SHAPE_CORNER_NXPZ;
      else if (e && s) shape = SHAPE_CORNER_NXNZ;
      else if (w && s) shape = SHAPE_CORNER_PXNZ;
      else if (n) shape = SHAPE_RAMP_PZ;
      else if (s) shape = SHAPE_RAMP_NZ;
      else if (w) shape = SHAPE_RAMP_PX;
      else shape = SHAPE_RAMP_NX;
      ctx.set(x, y, z, M, rgb, shape);
    }
  }
};

/** Hip ring plus a flat cube fill inside — a soft 1-high drift mound. */
const snowMound = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  rgb: number,
): void => {
  hipRing(ctx, x0, z0, x1, z1, y, rgb);
  if (x1 - x0 >= 2 && z1 - z0 >= 2) ctx.box(x0 + 1, y, z0 + 1, x1 - 1, y, z1 - 1, M, rgb);
};

/** One square canopy tier: closed ramp ring with a solid core. */
const pineTier = (
  ctx: SceneCtx,
  cx: number,
  y: number,
  cz: number,
  w: number,
  rgb: number,
): void => {
  hipRing(ctx, cx - w, cz - w, cx + w, cz + w, y, rgb);
  if (w >= 1) ctx.box(cx - w + 1, y, cz - w + 1, cx + w - 1, y, cz + w - 1, M, rgb);
};

/** Snow-dusted pine: dark trunk, stacked full-ring tiers, frosted top, slab cap. */
const pine = (ctx: SceneCtx, cx: number, yb: number, cz: number, big: boolean): void => {
  if (big) {
    ctx.box(cx, yb, cz, cx, yb + 5, cz, M, WOOD_DARK);
    pineTier(ctx, cx, yb + 2, cz, 3, PINE_DARK);
    pineTier(ctx, cx, yb + 4, cz, 2, PINE);
    pineTier(ctx, cx, yb + 6, cz, 1, PINE_FROST);
    ctx.set(cx, yb + 7, cz, M, PINE_FROST);
    ctx.set(cx, yb + 8, cz, M, SNOW_BRIGHT, SHAPE_SLAB_BOTTOM);
  } else {
    ctx.box(cx, yb, cz, cx, yb + 3, cz, M, WOOD_DARK);
    pineTier(ctx, cx, yb + 2, cz, 2, PINE_DARK);
    pineTier(ctx, cx, yb + 4, cz, 1, PINE);
    ctx.set(cx, yb + 5, cz, M, PINE_FROST);
    ctx.set(cx, yb + 6, cz, M, SNOW_BRIGHT, SHAPE_SLAB_BOTTOM);
  }
};

// ── cabin footprint ───────────────────────────────────────────────────────────

const CAB_X0 = 31;
const CAB_X1 = 44;
const CAB_Z0 = 45;
const CAB_Z1 = 54;
const WALL_Y0 = 1;
const WALL_Y1 = 6;
const ROOF_Y = 7;

// ── build ─────────────────────────────────────────────────────────────────────

const build = (ctx: SceneCtx): void => {
  // ── terrain: snow field, back plateau, drifts ──────────────────────────────
  ctx.box(0, 0, 0, 95, 0, 95, M, SNOW);

  // raised drift plateau behind the cabin (low X / high Z), with a complete
  // ramp contour: one run per exposed edge plus the single outer corner.
  ctx.box(0, 1, 58, 24, 1, 95, M, SNOW_BRIGHT);
  ctx.box(0, 1, 57, 24, 1, 57, M, SNOW_BRIGHT, SHAPE_RAMP_PZ);
  ctx.box(25, 1, 58, 25, 1, 95, M, SNOW_BRIGHT, SHAPE_RAMP_NX);
  ctx.set(25, 1, 57, M, SNOW_BRIGHT, SHAPE_CORNER_NXPZ);

  // low drift lenses flanking the path and dotting the open field — each one a
  // closed two-row hip ring (tent profile), never a lone wedge.
  hipRing(ctx, 48, 46, 56, 47, 1, SNOW_BRIGHT);
  hipRing(ctx, 48, 52, 56, 53, 1, SNOW_BRIGHT);
  snowMound(ctx, 70, 40, 75, 44, 1, SNOW_BRIGHT);
  snowMound(ctx, 24, 20, 28, 23, 1, SNOW_BRIGHT);

  // shoveled path, sunk half a step into the field: gate to door.
  ctx.box(46, 0, 49, 66, 0, 50, M, PATH, SHAPE_SLAB_BOTTOM);

  // ── frozen pond (foreground, high X / low Z) ───────────────────────────────
  // rounded basin: stone coping ring one level above the ice, glass sheet over
  // a full water course below.
  {
    const PX0 = 64;
    const PX1 = 77;
    const PZ0 = 16;
    const INSET = [5, 3, 2, 1, 1, 0, 0, 0, 0, 1, 1, 2, 3, 5];
    const inside = (x: number, z: number): boolean => {
      const r = z - PZ0;
      if (r < 0 || r >= INSET.length) return false;
      return x >= PX0 + INSET[r] && x <= PX1 - INSET[r];
    };
    for (let z = PZ0; z < PZ0 + INSET.length; z++) {
      for (let x = PX0; x <= PX1; x++) {
        if (!inside(x, z)) continue;
        const rim =
          !inside(x - 1, z) || !inside(x + 1, z) || !inside(x, z - 1) || !inside(x, z + 1);
        if (rim) {
          ctx.set(x, 1, z, M, STONE);
        } else {
          ctx.set(x, 0, z, CLS_WATER, WATER);
          ctx.set(x, 1, z, MaterialClass.Glass, ICE, SHAPE_SLAB_BOTTOM);
        }
      }
    }
    // one plank bench facing the ice
    ctx.box(61, 1, 21, 61, 1, 23, M, FENCE, SHAPE_SLAB_BOTTOM);
  }

  // ── cabin: log walls, door, glowing windows, shutters ──────────────────────
  // log courses alternate two wood tones; dark corner posts square the mass.
  for (let y = WALL_Y0; y <= WALL_Y1; y++) {
    const rgb = (y & 1) === 1 ? LOG_LIGHT : LOG_DARK;
    ctx.box(CAB_X0, y, CAB_Z0, CAB_X1, y, CAB_Z0, M, rgb);
    ctx.box(CAB_X0, y, CAB_Z1, CAB_X1, y, CAB_Z1, M, rgb);
    ctx.box(CAB_X0, y, CAB_Z0 + 1, CAB_X0, y, CAB_Z1 - 1, M, rgb);
    ctx.box(CAB_X1, y, CAB_Z0 + 1, CAB_X1, y, CAB_Z1 - 1, M, rgb);
  }
  ctx.box(CAB_X0, WALL_Y0, CAB_Z0, CAB_X0, WALL_Y1, CAB_Z0, M, WOOD_DARK);
  ctx.box(CAB_X1, WALL_Y0, CAB_Z0, CAB_X1, WALL_Y1, CAB_Z0, M, WOOD_DARK);
  ctx.box(CAB_X0, WALL_Y0, CAB_Z1, CAB_X0, WALL_Y1, CAB_Z1, M, WOOD_DARK);
  ctx.box(CAB_X1, WALL_Y0, CAB_Z1, CAB_X1, WALL_Y1, CAB_Z1, M, WOOD_DARK);

  // front door (+X face): dark frame posts + header, recessed plank door panel.
  ctx.box(CAB_X1, 1, 48, CAB_X1, 4, 48, M, WOOD_DARK);
  ctx.box(CAB_X1, 1, 51, CAB_X1, 4, 51, M, WOOD_DARK);
  ctx.box(CAB_X1, 4, 49, CAB_X1, 4, 50, M, WOOD_DARK);
  ctx.box(CAB_X1, 1, 49, CAB_X1, 3, 50, M, WOOD_DARK, SHAPE_VSLAB_PX);

  // front windows (+X face): warm emissive panes, paired plank shutters.
  ctx.box(CAB_X1, 3, 46, CAB_X1, 4, 47, MaterialClass.Emissive, GLOW);
  ctx.box(CAB_X1, 3, 52, CAB_X1, 4, 53, MaterialClass.Emissive, GLOW);
  ctx.box(CAB_X1 + 1, 3, 45, CAB_X1 + 1, 4, 45, M, WOOD_DARK, SHAPE_VSLAB_NX);
  ctx.box(CAB_X1 + 1, 3, 48, CAB_X1 + 1, 4, 48, M, WOOD_DARK, SHAPE_VSLAB_NX);
  ctx.box(CAB_X1 + 1, 3, 51, CAB_X1 + 1, 4, 51, M, WOOD_DARK, SHAPE_VSLAB_NX);
  ctx.box(CAB_X1 + 1, 3, 54, CAB_X1 + 1, 4, 54, M, WOOD_DARK, SHAPE_VSLAB_NX);

  // side windows (-Z face): same treatment so both hero faces glow.
  ctx.box(34, 3, CAB_Z0, 35, 4, CAB_Z0, MaterialClass.Emissive, GLOW);
  ctx.box(39, 3, CAB_Z0, 40, 4, CAB_Z0, MaterialClass.Emissive, GLOW);
  ctx.box(33, 3, CAB_Z0 - 1, 33, 4, CAB_Z0 - 1, M, WOOD_DARK, SHAPE_VSLAB_PZ);
  ctx.box(36, 3, CAB_Z0 - 1, 36, 4, CAB_Z0 - 1, M, WOOD_DARK, SHAPE_VSLAB_PZ);
  ctx.box(38, 3, CAB_Z0 - 1, 38, 4, CAB_Z0 - 1, M, WOOD_DARK, SHAPE_VSLAB_PZ);
  ctx.box(41, 3, CAB_Z0 - 1, 41, 4, CAB_Z0 - 1, M, WOOD_DARK, SHAPE_VSLAB_PZ);

  // drift apron hugging the whole wall base: one unbroken hip ring; the two
  // cells in front of the door stay in the ring but read trodden.
  hipRing(ctx, CAB_X0 - 1, CAB_Z0 - 1, CAB_X1 + 1, CAB_Z1 + 1, 1, SNOW);
  ctx.set(CAB_X1 + 1, 1, 49, M, PATH, SHAPE_RAMP_NX);
  ctx.set(CAB_X1 + 1, 1, 50, M, PATH, SHAPE_RAMP_NX);

  // ── roof: snow slab eaves, full hip rings to the ridge ─────────────────────
  for (let x = CAB_X0 - 2; x <= CAB_X1 + 2; x++) {
    for (let z = CAB_Z0 - 2; z <= CAB_Z1 + 2; z++) {
      const edge = x === CAB_X0 - 2 || x === CAB_X1 + 2 || z === CAB_Z0 - 2 || z === CAB_Z1 + 2;
      if (edge) ctx.set(x, ROOF_Y, z, M, SNOW_SHADE, SHAPE_SLAB_BOTTOM);
    }
  }
  for (let k = 0; ; k++) {
    const x0 = CAB_X0 - 1 + k;
    const x1 = CAB_X1 + 1 - k;
    const z0 = CAB_Z0 - 1 + k;
    const z1 = CAB_Z1 + 1 - k;
    if (x1 - x0 < 1 || z1 - z0 < 1) break;
    hipRing(ctx, x0, z0, x1, z1, ROOF_Y + k, k >= 3 ? SNOW_BRIGHT : SNOW);
  }

  // ── chimney + smoke ────────────────────────────────────────────────────────
  // brick stack swallows the west end of the ridge ring, so every remaining
  // ridge ramp terminates flush against a full cube.
  for (let y = 8; y <= 16; y++) {
    ctx.box(35, y, 49, 36, y, 50, M, (y & 1) === 0 ? BRICK : BRICK_DARK);
  }
  ctx.box(35, 17, 49, 36, 17, 50, M, STONE_DARK, SHAPE_SLAB_BOTTOM);
  ctx.box(35, 19, 49, 36, 19, 50, M, SMOKE);
  ctx.set(35, 21, 49, M, SMOKE);
  ctx.set(34, 23, 48, M, SMOKE);

  // ── yard fence: plank panels, posts, gate, lantern ─────────────────────────
  // front run faces the camera; two short returns square off the yard.
  ctx.box(58, 1, 36, 58, 2, 62, M, FENCE, SHAPE_VSLAB_PX);
  ctx.box(51, 1, 36, 57, 2, 36, M, FENCE, SHAPE_VSLAB_NZ);
  ctx.box(51, 1, 62, 57, 2, 62, M, FENCE, SHAPE_VSLAB_PZ);
  ctx.box(58, 1, 49, 58, 2, 50, M, WOOD_DARK, SHAPE_VSLAB_PX); // gate
  for (const z of [36, 42, 48, 51, 57, 62]) {
    ctx.box(58, 1, z, 58, 2, z, M, WOOD_DARK);
    ctx.set(58, 3, z, M, SNOW_BRIGHT, SHAPE_SLAB_BOTTOM); // snow on each post
  }
  ctx.box(51, 1, 36, 51, 2, 36, M, WOOD_DARK);
  ctx.set(51, 3, 36, M, SNOW_BRIGHT, SHAPE_SLAB_BOTTOM);
  ctx.box(51, 1, 62, 51, 2, 62, M, WOOD_DARK);
  ctx.set(51, 3, 62, M, SNOW_BRIGHT, SHAPE_SLAB_BOTTOM);

  // lantern post by the gate: metal column, warm head, metal cap.
  ctx.box(60, 1, 47, 60, 3, 47, CLS_METAL, METAL);
  ctx.set(60, 4, 47, MaterialClass.Emissive, LANTERN);
  ctx.set(60, 5, 47, CLS_METAL, METAL, SHAPE_SLAB_BOTTOM);

  // ── pines: tall behind on the plateau, mediums easing the edges ────────────
  pine(ctx, 10, 2, 70, true);
  pine(ctx, 19, 2, 84, true);
  pine(ctx, 16, 2, 92, false);
  pine(ctx, 8, 1, 40, false);
  pine(ctx, 56, 1, 82, true);
  pine(ctx, 70, 1, 74, false);
};

export const scene: SceneSpec = {
  id: "winter-cabin",
  name: "Winter Cabin",
  blurb: "warm lights in fresh snow",
  cx: 3,
  cy: 2,
  cz: 3,
  build,
};
