import type { SceneCtx, SceneSpec } from "../scene";
import {
  MaterialClass,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_PX,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
} from "../scene";

// Deterministic 2D hash -> [0, 1) so rock jitter/speckle is stable across runs.
const hash2 = (a: number, b: number): number => {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000;
};

const SEABED_A = 0x243038;
const SEABED_B = 0x1c272e;
const WATER = 0x2e6f78;
const SPARKLE = 0xa9dde2;
const ROCKS = [0x575c63, 0x6b7076, 0x7d8288];
const CREAM = 0xe8e0cf;
const CORAL = 0xc4524a;
const SLATE = 0x3c4148;
const STONE_A = 0x8a8f96;
const STONE_B = 0x767b83;
const WOOD_DARK = 0x6e4630;
const WOOD_LIGHT = 0x8a5a3b;
const LANTERN = 0xffd9a0;
const GLASS_PANE = 0xbfe3ea;
const GULL = 0xf4f4f0;

const PAD0 = 10;
const PAD1 = 79;
const ISLE_X = 27;
const ISLE_Z = 27;
// Islet radius per height, y = 1..8.
const ISLE_R = [12, 11, 10, 9, 8, 7, 6, 6];
// Shelf the keeper's hut sits on, y = 1..3.
const SHELF_X = 38;
const SHELF_Z = 32;
const SHELF_R = [8, 8, 7];

const fillDisc = (
  ctx: SceneCtx,
  centerX: number,
  centerZ: number,
  y: number,
  r: number,
  cls: number,
  rgb: number,
  shape = 0,
): void => {
  const rr = (r + 0.5) * (r + 0.5);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz <= rr) ctx.set(centerX + dx, y, centerZ + dz, cls, rgb, shape);
    }
  }
};

const fillRing = (
  ctx: SceneCtx,
  centerX: number,
  centerZ: number,
  y: number,
  rInner: number,
  rOuter: number,
  cls: number,
  rgb: number,
  shape = 0,
): void => {
  const lo = (rInner + 0.5) * (rInner + 0.5);
  const hi = (rOuter + 0.5) * (rOuter + 0.5);
  const r = Math.ceil(rOuter) + 1;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dz * dz;
      if (d > lo && d <= hi) ctx.set(centerX + dx, y, centerZ + dz, cls, rgb, shape);
    }
  }
};

const buildSea = (ctx: SceneCtx): void => {
  for (let z = PAD0; z <= PAD1; z++) {
    for (let x = PAD0; x <= PAD1; x++) {
      ctx.set(x, 0, z, MaterialClass.Matte, (x + z) & 1 ? SEABED_A : SEABED_B);
      const dx = x - ISLE_X;
      const dz = z - ISLE_Z;
      const d = dx * dx + dz * dz;
      // Glass sparkle band hugging the islet shore, broken up by hash.
      const sparkle = d > 156 && d <= 210 && hash2(x, z) > 0.45;
      if (sparkle) ctx.set(x, 1, z, MaterialClass.Glass, SPARKLE);
      else ctx.set(x, 1, z, MaterialClass.Gloss, WATER);
    }
  }
};

const buildRock = (ctx: SceneCtx, centerX: number, centerZ: number, radii: number[]): void => {
  for (let i = 0; i < radii.length; i++) {
    const y = 1 + i;
    const r = radii[i];
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        // Per-column jitter (-1..1) keeps the shoreline irregular but stable.
        const jitter = Math.floor(hash2(centerX + dx, centerZ + dz) * 3) - 1;
        const rj = r + jitter;
        if (dx * dx + dz * dz <= (rj + 0.5) * (rj + 0.5)) {
          const rgb = ROCKS[Math.floor(hash2(dx + 99 + y, dz - 99) * 3)];
          ctx.set(centerX + dx, y, centerZ + dz, MaterialClass.Matte, rgb);
        }
      }
    }
  }
};

const buildTower = (ctx: SceneCtx): void => {
  // Tapered shaft, alternating 3-row cream/coral bands, radius 5 -> 3.
  for (let y = 9; y <= 26; y++) {
    const row = y - 9;
    const r = row < 6 ? 5 : row < 12 ? 4 : 3;
    const band = Math.floor(row / 3);
    fillDisc(ctx, ISLE_X, ISLE_Z, y, r, MaterialClass.Matte, band % 2 === 0 ? CREAM : CORAL);
  }
  // Gallery deck ring around the top band.
  fillRing(ctx, ISLE_X, ISLE_Z, 26, 3, 4.2, MaterialClass.Matte, SLATE, SHAPE_SLAB_TOP);
  // Lantern room: glass walls around an emissive core.
  for (let y = 27; y <= 29; y++) {
    fillRing(ctx, ISLE_X, ISLE_Z, y, 1, 2.2, MaterialClass.Glass, GLASS_PANE);
    ctx.set(ISLE_X, y, ISLE_Z, MaterialClass.Emissive, LANTERN);
  }
  fillDisc(ctx, ISLE_X, ISLE_Z, 30, 2, MaterialClass.Matte, SLATE, SHAPE_SLAB_BOTTOM);
  ctx.set(ISLE_X, 31, ISLE_Z, MaterialClass.Matte, SLATE, SHAPE_SLAB_BOTTOM);
};

const buildHut = (ctx: SceneCtx): void => {
  // Stone walls on the shelf top (y=3), dithered two-tone.
  for (let y = 4; y <= 6; y++) {
    for (let z = 29; z <= 34; z++) {
      for (let x = 34; x <= 40; x++) {
        ctx.set(x, y, z, MaterialClass.Matte, (x + z + y) & 1 ? STONE_A : STONE_B);
      }
    }
  }
  // Gable roof, ridge along z: west slope rises +x, east slope rises -x.
  for (let z = 28; z <= 35; z++) {
    ctx.set(34, 7, z, MaterialClass.Matte, SLATE, SHAPE_RAMP_PX);
    ctx.box(35, 7, z, 39, 7, z, MaterialClass.Matte, SLATE);
    ctx.set(40, 7, z, MaterialClass.Matte, SLATE, SHAPE_RAMP_NX);
    ctx.set(35, 8, z, MaterialClass.Matte, SLATE, SHAPE_RAMP_PX);
    ctx.box(36, 8, z, 38, 8, z, MaterialClass.Matte, SLATE);
    ctx.set(39, 8, z, MaterialClass.Matte, SLATE, SHAPE_RAMP_NX);
    ctx.set(36, 9, z, MaterialClass.Matte, SLATE, SHAPE_RAMP_PX);
    ctx.set(37, 9, z, MaterialClass.Matte, SLATE);
    ctx.set(38, 9, z, MaterialClass.Matte, SLATE, SHAPE_RAMP_NX);
  }
  // One warm lit window facing the water, plus a wooden door toward the pier.
  ctx.set(37, 5, 34, MaterialClass.Emissive, LANTERN);
  ctx.set(40, 4, 31, MaterialClass.Matte, WOOD_DARK);
  ctx.set(40, 5, 31, MaterialClass.Matte, WOOD_DARK);
};

const buildPier = (ctx: SceneCtx): void => {
  for (let x = 45; x <= 66; x++) {
    const plank = x & 1 ? WOOD_LIGHT : WOOD_DARK;
    ctx.set(x, 3, 31, MaterialClass.Matte, plank);
    ctx.set(x, 3, 32, MaterialClass.Matte, plank);
  }
  for (let x = 46; x <= 66; x += 4) {
    ctx.box(x, 1, 31, x, 2, 31, MaterialClass.Matte, WOOD_DARK);
    ctx.box(x, 1, 32, x, 2, 32, MaterialClass.Matte, WOOD_DARK);
  }
  // Mooring posts along the outer edge.
  for (let x = 50; x <= 66; x += 8) {
    ctx.set(x, 4, 30, MaterialClass.Matte, WOOD_DARK);
  }
};

const buildRowboat = (ctx: SceneCtx): void => {
  ctx.box(70, 2, 31, 74, 2, 32, MaterialClass.Matte, WOOD_LIGHT);
  ctx.box(69, 3, 31, 69, 3, 32, MaterialClass.Matte, WOOD_DARK);
  ctx.box(75, 3, 31, 75, 3, 32, MaterialClass.Matte, WOOD_DARK);
  ctx.box(70, 3, 30, 74, 3, 30, MaterialClass.Matte, WOOD_DARK);
  ctx.box(70, 3, 33, 74, 3, 33, MaterialClass.Matte, WOOD_DARK);
  // Bench slabs.
  ctx.box(71, 3, 31, 71, 3, 32, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.box(73, 3, 31, 73, 3, 32, MaterialClass.Matte, WOOD_LIGHT, SHAPE_SLAB_BOTTOM);
};

const buildGulls = (ctx: SceneCtx): void => {
  const gulls: [number, number, number][] = [
    [52, 23, 16],
    [18, 25, 55],
    [62, 21, 60],
  ];
  for (const [x, y, z] of gulls) {
    ctx.set(x, y, z, MaterialClass.Matte, GULL);
    ctx.set(x - 1, y + 1, z, MaterialClass.Matte, GULL);
    ctx.set(x + 1, y + 1, z, MaterialClass.Matte, GULL);
  }
};

export const scene: SceneSpec = {
  id: "harbor-lighthouse",
  name: "Harbor Lighthouse",
  blurb: "striped beacon over a rocky cove",
  cx: 3,
  cy: 2,
  cz: 3,
  build(ctx: SceneCtx): void {
    buildSea(ctx);
    buildRock(ctx, ISLE_X, ISLE_Z, ISLE_R);
    buildRock(ctx, SHELF_X, SHELF_Z, SHELF_R);
    buildTower(ctx);
    buildHut(ctx);
    buildPier(ctx);
    buildRowboat(ctx);
    buildGulls(ctx);
  },
};
