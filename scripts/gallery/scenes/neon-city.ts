/**
 * Neon Alley — one rain-slick alley at midnight, pinched between two stepped
 * towers. The hero camera orbits to the +x/−z corner (azimuth −0.65 rad,
 * ~33° up), so the tall navy tower anchors the back-left, the low charcoal
 * tower sits front-right with its mass pushed to +z, and the alley mouth
 * opens straight toward the lens: gutter water, noodle stall, fire escape
 * and the magenta blade sign all read down that gap.
 *
 * Plan (x → right of frame, z → away from camera):
 *   west tower  x16..40, z16..56 — three setback tiers, parapet slabs, h≈49
 *   alley       x41..51          — gutter channel at x46, stall at the mouth
 *   east tower  x52..76, z38..70 — two setback tiers, h≈23
 */
import type { SceneCtx, SceneSpec } from "../scene";
import {
  CLS_METAL,
  CLS_PLASMA,
  CLS_WATER,
  MaterialClass,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
  SHAPE_VSLAB_NX,
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
} from "../scene";

// ── palette: deep blues and charcoals, two neon hues, warm amber pools ──────

const ASPHALT = 0x14171d;
const ASPHALT_ALLEY = 0x10131a;
const SIDEWALK = 0x262b35;
const CURB = 0x333a47;
const PUDDLE = 0x1e2c40; // gloss rain sheets catching the signs
const WARM_SPILL = 0x5a4226; // gloss — lamplight pooling on wet asphalt

const NAVY_BASE = 0x141a26;
const NAVY_BODY = 0x1f2839;
const NAVY_TOP = 0x2b3850;
const NAVY_TRIM = 0x3a4a68;

const CHAR_BASE = 0x191b21;
const CHAR_BODY = 0x24272f;
const CHAR_TOP = 0x303541;
const CHAR_TRIM = 0x434a59;

const GLASS_DARK = 0x101a28;
const GLASS_LIT = 0x39506b;
const AMBER_HI = 0xffbe6a;
const AMBER_LO = 0xd98f43;

const NEON_MAGENTA = 0xff48d0;
const NEON_CYAN = 0x36e2ff;

const METAL_DARK = 0x39404e;
const METAL_LIGHT = 0x5d6878;
const WATER_INK = 0x152538;

const WOOD_DARK = 0x4a3526;
const WOOD_LIGHT = 0x77573a;
const AWNING_RED = 0xa83838;
const AWNING_DARK = 0x6e2626;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Four wall boxes around a rectangular footprint, y0..y1 inclusive. */
const ring = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  cls: number,
  rgb: number,
  shape?: number,
): void => {
  ctx.box(x0, y0, z0, x1, y1, z0, cls, rgb, shape);
  ctx.box(x0, y0, z1, x1, y1, z1, cls, rgb, shape);
  ctx.box(x0, y0, z0 + 1, x0, y1, z1 - 1, cls, rgb, shape);
  ctx.box(x1, y0, z0 + 1, x1, y1, z1 - 1, cls, rgb, shape);
};

/** One setback tier: shell walls, a darker base course, roof deck, parapet slab ring. */
const tier = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  body: number,
  base: number,
  deck: number,
  trim: number,
): void => {
  ring(ctx, x0, z0, x1, z1, y0, y1, MaterialClass.Matte, body);
  ring(ctx, x0, z0, x1, z1, y0, y0 + 1, MaterialClass.Matte, base);
  ctx.box(x0 + 1, y1, z0 + 1, x1 - 1, y1, z1 - 1, MaterialClass.Matte, deck);
  ring(ctx, x0, z0, x1, z1, y1 + 1, y1 + 1, MaterialClass.Matte, trim, SHAPE_SLAB_BOTTOM);
};

/** Window material: clustered warm lit rooms, occasional pale glass, mostly dark panes. */
const pickWindow = (u: number, y: number, seed: number): readonly [number, number] => {
  const lit = (Math.floor(u / 6) * 5 + Math.floor(y / 9) * 3 + seed) % 5 < 2;
  if (lit) return [MaterialClass.Emissive, (u + y) % 2 === 0 ? AMBER_HI : AMBER_LO];
  if ((u * 7 + y * 11 + seed) % 19 === 3) return [MaterialClass.Glass, GLASS_LIT];
  return [MaterialClass.Glass, GLASS_DARK];
};

/** Grid of 1×2 windows punched into the wall plane x = wx, columns every 3 along z. */
const windowsX = (
  ctx: SceneCtx,
  wx: number,
  z0: number,
  z1: number,
  rows: readonly number[],
  seed: number,
): void => {
  for (let z = z0; z <= z1; z += 3)
    for (const y of rows) {
      const [cls, rgb] = pickWindow(z, y, seed);
      ctx.box(wx, y, z, wx, y + 1, z, cls, rgb);
    }
};

/** Grid of 1×2 windows punched into the wall plane z = wz, columns every 3 along x. */
const windowsZ = (
  ctx: SceneCtx,
  wz: number,
  x0: number,
  x1: number,
  rows: readonly number[],
  seed: number,
): void => {
  for (let x = x0; x <= x1; x += 3)
    for (const y of rows) {
      const [cls, rgb] = pickWindow(x, y, seed);
      ctx.box(x, y, wz, x, y + 1, wz, cls, rgb);
    }
};

// ── street level ─────────────────────────────────────────────────────────────

const buildStreet = (ctx: SceneCtx): void => {
  // asphalt pad, darker strip down the alley, lighter sidewalk aprons
  ctx.box(14, 0, 10, 82, 0, 84, MaterialClass.Matte, ASPHALT);
  ctx.box(41, 0, 10, 51, 0, 84, MaterialClass.Matte, ASPHALT_ALLEY);
  ctx.box(15, 0, 11, 81, 0, 14, MaterialClass.Matte, SIDEWALK);
  ctx.box(14, 0, 11, 15, 0, 60, MaterialClass.Matte, SIDEWALK);
  ctx.box(49, 0, 34, 80, 0, 37, MaterialClass.Matte, SIDEWALK);

  // gloss rain sheets where the neon lands
  ctx.box(42, 0, 14, 45, 0, 19, MaterialClass.Gloss, PUDDLE);
  ctx.box(48, 0, 31, 51, 0, 34, MaterialClass.Gloss, PUDDLE);
  ctx.box(55, 0, 26, 59, 0, 30, MaterialClass.Gloss, PUDDLE);
  ctx.box(63, 0, 16, 67, 0, 20, MaterialClass.Gloss, PUDDLE);
};

const buildGutter = (ctx: SceneCtx): void => {
  // water channel down the alley centre, half a level below its solid curbs
  ctx.box(45, 1, 12, 45, 1, 82, MaterialClass.Matte, CURB, SHAPE_SLAB_BOTTOM);
  ctx.box(47, 1, 12, 47, 1, 82, MaterialClass.Matte, CURB, SHAPE_SLAB_BOTTOM);
  ctx.box(46, 0, 12, 46, 0, 82, CLS_WATER, WATER_INK, SHAPE_SLAB_BOTTOM);
};

// ── towers ───────────────────────────────────────────────────────────────────

const buildWestTower = (ctx: SceneCtx): void => {
  tier(ctx, 16, 16, 40, 56, 1, 18, NAVY_BODY, NAVY_BASE, NAVY_BASE, NAVY_TRIM);
  tier(ctx, 19, 20, 37, 52, 19, 34, NAVY_BODY, NAVY_BASE, NAVY_BASE, NAVY_TRIM);
  tier(ctx, 23, 24, 33, 46, 35, 48, NAVY_TOP, NAVY_BODY, NAVY_BASE, NAVY_TRIM);

  // window grids on the two camera-facing planes of every tier
  windowsX(ctx, 40, 19, 53, [4, 9, 14], 1); // alley wall
  windowsZ(ctx, 16, 19, 37, [4, 9, 14], 2); // front
  windowsX(ctx, 37, 23, 49, [22, 27, 31], 3);
  windowsZ(ctx, 20, 22, 34, [22, 27, 31], 4);
  windowsX(ctx, 33, 27, 43, [38, 43], 5);
  windowsZ(ctx, 24, 26, 30, [38, 43], 6);

  // framed service door onto the alley, lamp tucked under the fire-escape landing
  ctx.box(40, 1, 29, 40, 5, 29, MaterialClass.Matte, NAVY_TRIM);
  ctx.box(40, 1, 32, 40, 5, 32, MaterialClass.Matte, NAVY_TRIM);
  ctx.box(40, 4, 30, 40, 5, 31, MaterialClass.Matte, NAVY_TRIM);
  for (let y = 1; y <= 3; y++) {
    ctx.clear(40, y, 30);
    ctx.clear(40, y, 31);
  }
  ctx.set(41, 5, 30, MaterialClass.Emissive, AMBER_LO, SHAPE_SLAB_TOP);
};

const buildEastTower = (ctx: SceneCtx): void => {
  tier(ctx, 52, 38, 76, 70, 1, 12, CHAR_BODY, CHAR_BASE, CHAR_BASE, CHAR_TRIM);
  tier(ctx, 55, 42, 73, 66, 13, 22, CHAR_TOP, CHAR_BODY, CHAR_BASE, CHAR_TRIM);

  windowsX(ctx, 76, 41, 67, [4, 8], 7);
  windowsZ(ctx, 38, 55, 73, [4, 8], 8);
  windowsX(ctx, 73, 45, 63, [15, 19], 9);
  windowsZ(ctx, 42, 58, 70, [15, 19], 10);

  // framed front door with a warm panel lamp above it
  ctx.box(61, 1, 38, 61, 5, 38, MaterialClass.Matte, CHAR_TRIM);
  ctx.box(64, 1, 38, 64, 5, 38, MaterialClass.Matte, CHAR_TRIM);
  ctx.box(62, 5, 38, 63, 5, 38, MaterialClass.Matte, CHAR_TRIM);
  for (let y = 1; y <= 4; y++) {
    ctx.clear(62, y, 38);
    ctx.clear(63, y, 38);
  }
  ctx.set(62, 6, 37, MaterialClass.Emissive, AMBER_LO, SHAPE_VSLAB_PZ);
  ctx.set(63, 6, 37, MaterialClass.Emissive, AMBER_LO, SHAPE_VSLAB_PZ);
};

// ── neon signage: plasma strips in continuous vertical runs ──────────────────

const buildSigns = (ctx: SceneCtx): void => {
  // magenta blade at the alley mouth on the west tower, facing the lens
  ctx.box(41, 3, 20, 41, 20, 21, CLS_PLASMA, NEON_MAGENTA, SHAPE_VSLAB_NX);
  // cyan strip beside the east tower's alley corner
  ctx.box(54, 3, 37, 54, 12, 37, CLS_PLASMA, NEON_CYAN, SHAPE_VSLAB_PZ);
  // cyan strip high on the west tower front
  ctx.box(21, 8, 15, 21, 17, 15, CLS_PLASMA, NEON_CYAN, SHAPE_VSLAB_PZ);
  // low magenta strip on the west tower front — neon at street level
  ctx.box(27, 2, 15, 27, 7, 15, CLS_PLASMA, NEON_MAGENTA, SHAPE_VSLAB_PZ);
};

// ── fire escape on the west alley wall: switchback of complete ramp runs ─────

const buildFireEscape = (ctx: SceneCtx): void => {
  // street → L1, two voxels wide so every ramp continues into a same-slope neighbour
  for (let i = 0; i < 5; i++)
    ctx.box(41, 1 + i, 24 + i, 42, 1 + i, 24 + i, CLS_METAL, METAL_LIGHT, SHAPE_RAMP_PZ);
  ctx.box(41, 6, 29, 42, 6, 40, CLS_METAL, METAL_DARK, SHAPE_SLAB_BOTTOM); // landing one
  for (let i = 0; i < 5; i++)
    ctx.box(41, 7 + i, 41 + i, 42, 7 + i, 41 + i, CLS_METAL, METAL_LIGHT, SHAPE_RAMP_PZ);
  ctx.box(41, 12, 46, 42, 12, 54, CLS_METAL, METAL_DARK, SHAPE_SLAB_BOTTOM); // landing two
  for (let i = 0; i < 5; i++)
    ctx.box(41, 13 + i, 54 - i, 42, 13 + i, 54 - i, CLS_METAL, METAL_LIGHT, SHAPE_RAMP_NZ);
  ctx.box(41, 18, 48, 42, 18, 49, CLS_METAL, METAL_DARK, SHAPE_SLAB_BOTTOM); // roof step-off

  // rails: continuous panel runs along each landing's open edge
  ctx.box(42, 7, 29, 42, 7, 40, CLS_METAL, METAL_DARK, SHAPE_VSLAB_PX);
  ctx.box(42, 13, 46, 42, 13, 49, CLS_METAL, METAL_DARK, SHAPE_VSLAB_PX);

  // support posts under the outer corners
  ctx.box(42, 1, 29, 42, 5, 29, CLS_METAL, METAL_DARK);
  ctx.box(42, 1, 40, 42, 5, 40, CLS_METAL, METAL_DARK);
  ctx.box(42, 1, 46, 42, 11, 46, CLS_METAL, METAL_DARK);
  ctx.box(42, 1, 54, 42, 11, 54, CLS_METAL, METAL_DARK);
};

// ── exhaust ducts: one unbroken climb at the alley mouth ─────────────────────

const buildDucts = (ctx: SceneCtx): void => {
  ctx.box(41, 1, 17, 41, 20, 18, CLS_METAL, METAL_DARK); // twin riser, street to sky
  ctx.box(39, 20, 17, 40, 20, 18, CLS_METAL, METAL_DARK); // elbow over the parapet
  ctx.box(39, 19, 17, 39, 19, 18, CLS_METAL, METAL_DARK); // drop onto the deck
  ctx.box(38, 19, 17, 38, 19, 18, CLS_METAL, METAL_LIGHT); // vent cap
};

// ── noodle stall at the alley mouth ──────────────────────────────────────────

const buildStall = (ctx: SceneCtx): void => {
  for (const [x, z] of [
    [48, 22],
    [51, 22],
    [48, 29],
    [51, 29],
  ] as const)
    ctx.box(x, 1, z, x, 4, z, MaterialClass.Matte, WOOD_DARK);

  // counter with a lighter top course
  ctx.box(48, 1, 23, 51, 1, 28, MaterialClass.Matte, WOOD_DARK);
  ctx.box(48, 2, 23, 51, 2, 28, MaterialClass.Matte, WOOD_LIGHT);
  ctx.set(49, 3, 26, CLS_METAL, METAL_LIGHT); // soup pot
  ctx.set(50, 3, 24, MaterialClass.Matte, AWNING_RED); // stacked bowls

  // roof slab with striped valance runs on the two street faces
  ctx.box(47, 5, 22, 51, 5, 30, MaterialClass.Matte, AWNING_DARK, SHAPE_SLAB_TOP);
  for (let x = 47; x <= 52; x++)
    ctx.set(x, 5, 21, MaterialClass.Matte, x % 2 === 0 ? AWNING_RED : AWNING_DARK, SHAPE_VSLAB_PZ);
  for (let z = 22; z <= 30; z++)
    ctx.set(52, 5, z, MaterialClass.Matte, z % 2 === 0 ? AWNING_RED : AWNING_DARK, SHAPE_VSLAB_NX);

  // warm glow under the awning, stools out front
  ctx.box(49, 4, 24, 50, 4, 27, MaterialClass.Emissive, AMBER_HI, SHAPE_SLAB_TOP);
  ctx.set(48, 1, 20, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.set(51, 1, 20, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_BOTTOM);
};

// ── dressing: lantern strings, street props, rooftop kit ─────────────────────

const buildLanterns = (ctx: SceneCtx): void => {
  // two strings across the alley, deliberate sparse accents over the gutter
  for (const z of [25, 33])
    for (const x of [43, 45, 47])
      ctx.set(x, 7, z, MaterialClass.Emissive, AMBER_HI, SHAPE_SLAB_TOP);
};

const buildStreetProps = (ctx: SceneCtx): void => {
  // corner streetlamp at the alley mouth, with its pool of light on the wet street
  ctx.box(44, 1, 13, 44, 7, 13, CLS_METAL, METAL_DARK);
  ctx.set(44, 8, 13, MaterialClass.Emissive, AMBER_HI);
  ctx.box(42, 0, 11, 45, 0, 15, MaterialClass.Gloss, WARM_SPILL);
  // warm spill from the stall lights across the alley floor
  ctx.box(47, 0, 20, 52, 0, 31, MaterialClass.Gloss, WARM_SPILL);
  // dumpster below landing two
  ctx.box(43, 1, 48, 44, 2, 51, CLS_METAL, METAL_DARK);
  ctx.box(43, 3, 48, 44, 3, 51, CLS_METAL, METAL_LIGHT, SHAPE_SLAB_BOTTOM);
  // crates at the east tower corner
  ctx.box(53, 1, 31, 54, 1, 32, MaterialClass.Matte, WOOD_LIGHT);
  ctx.set(53, 2, 31, MaterialClass.Matte, WOOD_DARK);
};

const buildRoofProps = (ctx: SceneCtx): void => {
  // west tier three: water tank and a beacon mast
  ctx.box(26, 49, 28, 28, 51, 30, CLS_METAL, METAL_DARK);
  ctx.box(26, 52, 28, 28, 52, 30, CLS_METAL, METAL_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.box(31, 49, 43, 31, 54, 43, CLS_METAL, METAL_DARK);
  ctx.set(31, 55, 43, MaterialClass.Emissive, AMBER_HI);
  // east tier two: a/c units
  ctx.box(59, 23, 47, 60, 24, 48, CLS_METAL, METAL_DARK);
  ctx.box(66, 23, 55, 67, 24, 56, CLS_METAL, METAL_DARK);
};

// ── assembly ─────────────────────────────────────────────────────────────────

const build = (ctx: SceneCtx): void => {
  buildStreet(ctx);
  buildGutter(ctx);

  buildWestTower(ctx);
  buildEastTower(ctx);

  buildSigns(ctx);
  buildFireEscape(ctx);
  buildDucts(ctx);

  buildStall(ctx);
  buildLanterns(ctx);
  buildStreetProps(ctx);
  buildRoofProps(ctx);
};

export const scene: SceneSpec = {
  id: "neon-city",
  name: "Neon Alley",
  blurb: "rain-slick block at midnight",
  cx: 3,
  cy: 2,
  cz: 3,
  build,
};
