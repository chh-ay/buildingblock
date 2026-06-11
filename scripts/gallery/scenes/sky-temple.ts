import type { SceneCtx, SceneSpec } from "../scene";
import {
  MaterialClass,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
} from "../scene";

const ROCK_DARK = 0x4a4f57;
const ROCK_LIGHT = 0x5c6670;
const GRASS_A = 0x4f8a4c;
const GRASS_B = 0x3e6b46;
const TIMBER = 0x4a3527;
const ROOT = 0x6b5135;
const CREAM = 0xe8e0cf;
const TORII_RED = 0xb84a3e;
const ROOF_SLATE = 0x394048;
const WATER = 0x3f7fae;
const WATER_DEEP = 0x2c5d85;
const LANTERN = 0xffd9a0;
const STONE = 0x9aa0a8;
const CLOUD = 0xf4f4f0;
const GOLD = 0xd8b04a;

// Island centre and the y of its grass surface.
const ICX = 44;
const ICZ = 46;
const TOP_Y = 26;
// Per-layer radius, depth 0 = grass cap, deeper layers shrink into the cone tip.
const ISLAND_RADII = [15, 14.2, 13.2, 12, 10.6, 9.2, 7.8, 6.4, 5.1, 4, 3, 2.2, 1.5, 1];

const buildIsland = (ctx: SceneCtx): void => {
  for (let depth = 0; depth < ISLAND_RADII.length; depth++) {
    const y = TOP_Y - depth;
    const r = ISLAND_RADII[depth];
    const span = Math.ceil(r) + 1;
    for (let z = ICZ - span; z <= ICZ + span; z++) {
      for (let x = ICX - span; x <= ICX + span; x++) {
        const dx = x - ICX;
        const dz = z - ICZ;
        // Deterministic edge jitter so the rim reads organic instead of circular.
        const jitter = ((x * 13 + z * 7) % 3) * 0.45;
        const rr = r + (depth === 0 ? jitter : jitter * 0.5);
        if (dx * dx + dz * dz > rr * rr) continue;
        if (depth === 0) {
          ctx.set(x, y, z, MaterialClass.Matte, (x + z) & 1 ? GRASS_A : GRASS_B);
        } else {
          ctx.set(x, y, z, MaterialClass.Matte, (x + y + z) & 1 ? ROCK_DARK : ROCK_LIGHT);
        }
      }
    }
  }

  // Hanging root strands off the cone underside.
  const rootCols: ReadonlyArray<readonly [number, number]> = [
    [-12, 2],
    [-9, -7],
    [-4, 11],
    [3, -12],
    [8, 8],
    [11, -3],
    [6, 12],
    [-13, -3],
  ];
  for (const [dx, dz] of rootCols) {
    const dist = Math.hypot(dx, dz);
    let depth = 1;
    while (depth + 1 < ISLAND_RADII.length && ISLAND_RADII[depth + 1] > dist) depth++;
    const top = TOP_Y - depth - 1;
    const len = 2 + ((Math.abs(dx * 5 + dz * 3) >> 1) % 4);
    ctx.box(ICX + dx, top, ICZ + dz, ICX + dx, top - len, ICZ + dz, MaterialClass.Matte, ROOT);
  }
};

const buildPond = (ctx: SceneCtx): void => {
  const px = 51;
  const pz = 51;
  for (let z = pz - 3; z <= pz + 3; z++) {
    for (let x = px - 3; x <= px + 3; x++) {
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d > 10) continue;
      ctx.set(x, TOP_Y - 1, z, MaterialClass.Gloss, WATER_DEEP);
      ctx.set(x, TOP_Y, z, MaterialClass.Glass, WATER);
      if (d > 5 && (x + z) % 3 === 0)
        ctx.set(x, TOP_Y + 1, z, MaterialClass.Matte, STONE, SHAPE_SLAB_BOTTOM);
    }
  }
  // Spill channel east, then a 1-wide fall off the rim into mist.
  ctx.box(px + 3, TOP_Y, pz, 59, TOP_Y, pz, MaterialClass.Glass, WATER);
  ctx.box(60, TOP_Y - 1, pz, 60, TOP_Y - 8, pz, MaterialClass.Glass, WATER);
  const mist: ReadonlyArray<readonly [number, number, number]> = [
    [60, 17, 51],
    [59, 17, 50],
    [61, 18, 52],
    [60, 16, 50],
    [61, 17, 50],
    [59, 16, 52],
  ];
  for (const [x, y, z] of mist) ctx.set(x, y, z, MaterialClass.Matte, CLOUD, SHAPE_SLAB_BOTTOM);
};

const buildPath = (ctx: SceneCtx): void => {
  for (let z = 43; z <= 58; z++) {
    for (let x = 43; x <= 45; x++) {
      ctx.set(x, TOP_Y, z, MaterialClass.Matte, (x * 3 + z) & 1 ? STONE : ROCK_LIGHT);
    }
  }
};

const buildTorii = (ctx: SceneCtx): void => {
  const y0 = TOP_Y + 1;
  ctx.box(41, y0, 55, 41, y0 + 4, 55, MaterialClass.Matte, TORII_RED);
  ctx.box(47, y0, 55, 47, y0 + 4, 55, MaterialClass.Matte, TORII_RED);
  // Double lintel: lower tie beam, then the sweeping top beam with slab tips.
  ctx.box(40, y0 + 3, 55, 48, y0 + 3, 55, MaterialClass.Matte, TORII_RED);
  ctx.box(39, y0 + 5, 55, 49, y0 + 5, 55, MaterialClass.Matte, TORII_RED);
  ctx.set(38, y0 + 5, 55, MaterialClass.Matte, TORII_RED, SHAPE_SLAB_TOP);
  ctx.set(50, y0 + 5, 55, MaterialClass.Matte, TORII_RED, SHAPE_SLAB_TOP);
};

// One pagoda roof tier: ramp skirt around the box rim with upturned slab corners.
const roofTier = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
): void => {
  ctx.box(x0 + 1, y, z0 + 1, x1 - 1, y, z1 - 1, MaterialClass.Matte, ROOF_SLATE);
  ctx.box(x0, y, z0 + 1, x0, y, z1 - 1, MaterialClass.Matte, ROOF_SLATE, SHAPE_RAMP_PX);
  ctx.box(x1, y, z0 + 1, x1, y, z1 - 1, MaterialClass.Matte, ROOF_SLATE, SHAPE_RAMP_NX);
  ctx.box(x0 + 1, y, z0, x1 - 1, y, z0, MaterialClass.Matte, ROOF_SLATE, SHAPE_RAMP_PZ);
  ctx.box(x0 + 1, y, z1, x1 - 1, y, z1, MaterialClass.Matte, ROOF_SLATE, SHAPE_RAMP_NZ);
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) ctx.set(x, y, z, MaterialClass.Matte, ROOF_SLATE, SHAPE_SLAB_TOP);
  }
};

const buildPagoda = (ctx: SceneCtx): void => {
  const y0 = TOP_Y + 1;
  // Tier one: cream walls with dark timber corner posts.
  ctx.box(40, y0, 34, 48, y0 + 4, 42, MaterialClass.Matte, CREAM);
  for (const x of [40, 48]) {
    for (const z of [34, 42]) ctx.box(x, y0, z, x, y0 + 4, z, MaterialClass.Matte, TIMBER);
  }
  ctx.box(40, y0 + 4, 34, 48, y0 + 4, 42, MaterialClass.Matte, TIMBER);
  // South-facing doorway toward the torii path.
  for (let y = y0; y <= y0 + 2; y++) {
    for (let x = 43; x <= 45; x++) ctx.clear(x, y, 42);
  }
  roofTier(ctx, 39, 33, 49, 43, y0 + 5);
  // Tier two.
  ctx.box(42, y0 + 6, 36, 46, y0 + 9, 40, MaterialClass.Matte, CREAM);
  for (const x of [42, 46]) {
    for (const z of [36, 40]) ctx.box(x, y0 + 6, z, x, y0 + 9, z, MaterialClass.Matte, TIMBER);
  }
  roofTier(ctx, 41, 35, 47, 41, y0 + 10);
  ctx.set(44, y0 + 11, 38, MaterialClass.Matte, ROOF_SLATE);
  ctx.set(44, y0 + 12, 38, MaterialClass.Gloss, GOLD);
  ctx.set(44, y0 + 13, 38, MaterialClass.Gloss, GOLD, SHAPE_SLAB_BOTTOM);
};

const buildLanterns = (ctx: SceneCtx): void => {
  const y0 = TOP_Y + 1;
  for (const z of [46, 50, 54]) {
    for (const x of [41, 47]) {
      ctx.box(x, y0, z, x, y0 + 1, z, MaterialClass.Matte, TIMBER);
      ctx.set(x, y0 + 2, z, MaterialClass.Emissive, LANTERN);
      ctx.set(x, y0 + 3, z, MaterialClass.Matte, ROOF_SLATE, SHAPE_SLAB_BOTTOM);
    }
  }
};

const buildShrineStone = (ctx: SceneCtx): void => {
  const y0 = TOP_Y + 1;
  ctx.box(50, y0, 40, 51, y0, 41, MaterialClass.Matte, STONE);
  ctx.set(50, y0 + 1, 40, MaterialClass.Matte, ROCK_LIGHT);
  ctx.set(51, y0 + 1, 41, MaterialClass.Gloss, STONE, SHAPE_SLAB_BOTTOM);
  // A few mossy boulders scattered on the lawn.
  ctx.set(36, y0, 38, MaterialClass.Matte, ROCK_LIGHT);
  ctx.set(35, y0, 39, MaterialClass.Matte, ROCK_DARK, SHAPE_SLAB_BOTTOM);
  ctx.set(52, y0, 56, MaterialClass.Matte, ROCK_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.set(34, y0, 50, MaterialClass.Matte, ROCK_DARK, SHAPE_SLAB_BOTTOM);
};

const buildCloud = (
  ctx: SceneCtx,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  rz: number,
): void => {
  for (let z = cz - rz; z <= cz + rz; z++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = (x - cx) / rx;
      const nz = (z - cz) / rz;
      const d = nx * nx + nz * nz;
      const wobble = (((x * 13 + z * 29) % 3) - 1) * 0.18;
      if (d > 1 + wobble) continue;
      ctx.set(x, cy, z, MaterialClass.Matte, CLOUD, SHAPE_SLAB_TOP);
      if (d < 0.35) ctx.set(x, cy + 1, z, MaterialClass.Matte, CLOUD, SHAPE_SLAB_BOTTOM);
    }
  }
};

const build = (ctx: SceneCtx): void => {
  buildIsland(ctx);
  buildPath(ctx);
  buildPond(ctx);
  buildTorii(ctx);
  buildPagoda(ctx);
  buildLanterns(ctx);
  buildShrineStone(ctx);
  buildCloud(ctx, 20, 12, 24, 6, 4);
  buildCloud(ctx, 70, 11, 30, 5, 4);
  buildCloud(ctx, 24, 13, 68, 5, 5);
  buildCloud(ctx, 68, 12, 70, 6, 4);
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
