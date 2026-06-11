import type { SceneCtx, SceneSpec } from "../scene";
import {
  MaterialClass,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
} from "../scene";

// Deterministic 2D hash -> [0, 1) for stable wave streak break-up.
const hash2 = (a: number, b: number): number => {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000;
};

const WATER = 0x2e6f78;
const WATER_LIGHT = 0x47919b;
const KEEL = 0x4a3324;
const WOOD_DARK = 0x6e4630;
const WOOD_MID = 0x8a5a3b;
const DECK_A = 0xc9a877;
const DECK_B = 0xb08a5e;
const SAIL = 0xf2efe6;
const CORAL = 0xc4524a;
const LANTERN = 0xffd9a0;
const SLATE = 0x3c4148;

const PAD0 = 8;
const PAD1 = 87;
const CX = 47; // hull centreline
const Z0 = 28; // stern row; bow points toward +z

// Half-beam per hull row: flat transom, broad midship, tapering bow stem.
const HALF_W = [
  2, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1,
  0, 0, 0,
];
const QDECK_ROWS = 9; // raised quarterdeck over the stern rows

const buildSea = (ctx: SceneCtx): void => {
  for (let z = PAD0; z <= PAD1; z++) {
    for (let x = PAD0; x <= PAD1; x++) {
      const streak = (x * 2 + z * 5) % 31 < 2 && hash2(x, z) > 0.3;
      ctx.set(x, 0, z, MaterialClass.Gloss, streak ? WATER_LIGHT : WATER);
    }
  }
};

const buildHull = (ctx: SceneCtx): void => {
  for (let i = 0; i < HALF_W.length; i++) {
    const z = Z0 + i;
    const hw = HALF_W[i];
    if (hw >= 2) ctx.box(CX - (hw - 2), 1, z, CX + (hw - 2), 1, z, MaterialClass.Matte, KEEL);
    if (hw >= 1) {
      ctx.box(CX - (hw - 1), 2, z, CX + (hw - 1), 2, z, MaterialClass.Matte, WOOD_DARK);
    } else {
      ctx.set(CX, 2, z, MaterialClass.Matte, WOOD_DARK);
    }
    ctx.box(CX - hw, 3, z, CX + hw, 3, z, MaterialClass.Matte, WOOD_MID);
    // Deck planking, two tones.
    for (let x = CX - hw; x <= CX + hw; x++) {
      ctx.set(x, 4, z, MaterialClass.Matte, (x + z) & 1 ? DECK_A : DECK_B);
    }
    if (hw >= 1) {
      ctx.set(CX - hw, 5, z, MaterialClass.Matte, WOOD_MID);
      ctx.set(CX + hw, 5, z, MaterialClass.Matte, WOOD_MID);
    }
    // Side flares at the waterline strake.
    if (hw >= 2) {
      ctx.set(CX - hw - 1, 3, z, MaterialClass.Matte, WOOD_MID, SHAPE_RAMP_PX);
      ctx.set(CX + hw + 1, 3, z, MaterialClass.Matte, WOOD_MID, SHAPE_RAMP_NX);
    }
  }
  // Bow stem ramps rising back toward the hull.
  const bowZ = Z0 + HALF_W.length - 1;
  ctx.set(CX, 4, bowZ, MaterialClass.Matte, WOOD_MID, SHAPE_RAMP_NZ);
  ctx.set(CX, 4, bowZ - 1, MaterialClass.Matte, WOOD_MID, SHAPE_RAMP_NZ);
  // Stern transom ramp.
  ctx.box(CX - 2, 4, Z0 - 1, CX + 2, 4, Z0 - 1, MaterialClass.Matte, WOOD_MID, SHAPE_RAMP_PZ);
};

const buildQuarterdeck = (ctx: SceneCtx): void => {
  for (let i = 0; i < QDECK_ROWS; i++) {
    const z = Z0 + i;
    const hw = HALF_W[i];
    for (let x = CX - hw; x <= CX + hw; x++) {
      ctx.set(x, 5, z, MaterialClass.Matte, (x + z) & 1 ? DECK_B : DECK_A);
    }
    ctx.set(CX - hw, 6, z, MaterialClass.Matte, WOOD_MID);
    ctx.set(CX + hw, 6, z, MaterialClass.Matte, WOOD_MID);
  }
  // Stern rail across the transom.
  ctx.box(CX - 2, 6, Z0, CX + 2, 6, Z0, MaterialClass.Matte, WOOD_MID);
  // Half-step from main deck up to the quarterdeck.
  ctx.box(
    CX - 1,
    5,
    Z0 + QDECK_ROWS,
    CX + 1,
    5,
    Z0 + QDECK_ROWS,
    MaterialClass.Matte,
    DECK_A,
    SHAPE_SLAB_BOTTOM,
  );
  // Railing posts.
  for (const i of [0, 4, 8]) {
    const hw = HALF_W[i];
    ctx.set(CX - hw, 7, Z0 + i, MaterialClass.Matte, KEEL);
    ctx.set(CX + hw, 7, Z0 + i, MaterialClass.Matte, KEEL);
  }
  for (const i of [12, 16, 20, 24, 28]) {
    const hw = HALF_W[i];
    ctx.set(CX - hw, 6, Z0 + i, MaterialClass.Matte, KEEL);
    ctx.set(CX + hw, 6, Z0 + i, MaterialClass.Matte, KEEL);
  }
};

const buildSail = (
  ctx: SceneCtx,
  yBottom: number,
  yTop: number,
  xHalf: number,
  zBase: number,
): void => {
  // 1-voxel-thick pane, billowed toward the bow by a per-row z offset.
  const rows = yTop - yBottom;
  for (let y = yBottom; y <= yTop; y++) {
    const t = rows === 0 ? 0 : (yTop - y) / rows; // 0 at yard, 1 at foot
    const zOff = Math.round(Math.sin(t * Math.PI * 0.62) * 2);
    for (let x = CX - xHalf; x <= CX + xHalf; x++) {
      ctx.set(x, y, zBase + zOff, MaterialClass.Matte, SAIL);
    }
  }
};

const buildRig = (ctx: SceneCtx): void => {
  const mainZ = 42;
  const foreZ = 53;
  ctx.box(CX, 5, mainZ, CX, 25, mainZ, MaterialClass.Matte, KEEL);
  ctx.box(CX, 5, foreZ, CX, 22, foreZ, MaterialClass.Matte, KEEL);
  // Yardarms.
  ctx.box(CX - 6, 12, mainZ, CX + 6, 12, mainZ, MaterialClass.Matte, KEEL);
  ctx.box(CX - 5, 19, mainZ, CX + 5, 19, mainZ, MaterialClass.Matte, KEEL);
  ctx.box(CX - 5, 11, foreZ, CX + 5, 11, foreZ, MaterialClass.Matte, KEEL);
  ctx.box(CX - 4, 17, foreZ, CX + 4, 17, foreZ, MaterialClass.Matte, KEEL);
  // Square sails hung beneath each yard.
  buildSail(ctx, 6, 11, 5, mainZ + 1);
  buildSail(ctx, 13, 18, 4, mainZ + 1);
  buildSail(ctx, 6, 10, 4, foreZ + 1);
  buildSail(ctx, 12, 16, 3, foreZ + 1);
  // Coral pennant at the masthead, streaming aft-to-fore.
  ctx.box(CX, 25, mainZ + 1, CX, 25, mainZ + 3, MaterialClass.Matte, CORAL);
  ctx.box(CX, 24, mainZ + 1, CX, 24, mainZ + 2, MaterialClass.Matte, CORAL);
};

const buildDetails = (ctx: SceneCtx): void => {
  // Stern lantern on a short post.
  ctx.set(CX, 7, Z0 + 1, MaterialClass.Matte, KEEL);
  ctx.set(CX, 8, Z0 + 1, MaterialClass.Emissive, LANTERN);
  ctx.set(CX, 9, Z0 + 1, MaterialClass.Matte, SLATE, SHAPE_SLAB_BOTTOM);
  // Anchor buoy bobbing off the starboard bow.
  ctx.set(62, 1, 70, MaterialClass.Gloss, CORAL);
  ctx.set(61, 1, 70, MaterialClass.Gloss, CORAL);
  ctx.set(63, 1, 70, MaterialClass.Gloss, CORAL);
  ctx.set(62, 1, 69, MaterialClass.Gloss, CORAL);
  ctx.set(62, 1, 71, MaterialClass.Gloss, CORAL);
  ctx.set(62, 2, 70, MaterialClass.Matte, SAIL);
  ctx.set(62, 3, 70, MaterialClass.Gloss, CORAL, SHAPE_SLAB_BOTTOM);
};

export const scene: SceneSpec = {
  id: "sail-ship",
  name: "Sail Ship",
  blurb: "square-rigged sloop riding calm seas",
  cx: 3,
  cy: 2,
  cz: 3,
  build(ctx: SceneCtx): void {
    buildSea(ctx);
    buildHull(ctx);
    buildQuarterdeck(ctx);
    buildRig(ctx);
    buildDetails(ctx);
  },
};
