/**
 * Castle Keep — one compact fortress massed for the hero camera (azimuth
 * -0.65 rad: the lens sits at +X/-Z, ~33° up). Reading order from the lens:
 * calm meadow and dirt road, drawbridge over the square moat ring, gatehouse
 * with portcullis, curtain wall with continuous merlon runs, four slate-capped
 * corner towers, and the tall central keep anchoring the rear-left silhouette.
 *
 * Massing: ground & moat → curtain wall & wall stair → corner towers →
 * gatehouse & drawbridge → central keep → courtyard props → moss pass.
 */
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

// ── palette ─────────────────────────────────────────────────────────────────
const GRASS_LIGHT = 0x6b8a4f;
const GRASS_DARK = 0x59763f;
const DIRT_PATH = 0x9a8054;
const COURT_LIGHT = 0x8f7d5c; // packed courtyard earth
const COURT_DARK = 0x83704e;
const STONE_LIGHT = 0x9ba1a9; // three masonry greys, banded by course
const STONE_MID = 0x82888f;
const STONE_DARK = 0x686e75;
const MOSS = 0x6f7f4e;
const SLATE_LIGHT = 0x5d7089; // three slate tiers, banded by roof ring
const SLATE_MID = 0x4a5a72;
const SLATE_DARK = 0x39475c;
const WOOD = 0x8a5f38;
const WOOD_DARK = 0x5d4128;
const BANNER_RED = 0xa83434;
const BANNER_GOLD = 0xd2a648;
const AWNING_CREAM = 0xe9dfc6;
const IRON = 0x4a4f55;
const SLIT_DARK = 0x33383d;
const MOAT_WATER = 0x3e6f8e;
const WELL_WATER = 0x274b5e;
const TORCH_GLOW = 0xffc06a;
const WINDOW_GLOW = 0xffd9a0;
const GLASS_PANE = 0xbcd5e2;

const M = MaterialClass.Matte;

// ── layout ──────────────────────────────────────────────────────────────────
const W0 = 20; // curtain wall outer faces (inclusive)
const W1 = 67;
const N0 = 28;
const N1 = 75;
const WALL_TOP = 8; // curtain wall solid y1..8, walkway on top
const TOWER_TOP = 13; // tower shaft y1..13, slate cap above
const TOWER_XZ: ReadonlyArray<readonly [number, number]> = [
  [W0, N0],
  [W1, N0],
  [W0, N1],
  [W1, N1],
];
const KX0 = 30; // keep walls (14×14), plinth one cell wider
const KX1 = 43;
const KZ0 = 54;
const KZ1 = 67;
const KEEP_TOP = 19; // keep walls y2..19, hip roof from y20
const GH_X0 = 64; // gatehouse block, protrudes through the east wall
const GH_X1 = 71;
const GH_Z0 = 46;
const GH_Z1 = 56;
const GH_TOP = 11;
const GATE_Z0 = 50; // gate tunnel, 3 wide
const GATE_Z1 = 52;

/** Ring distance from the curtain-wall rectangle: 0 on/inside the wall line. */
const moatDist = (x: number, z: number): number => {
  const dx = Math.max(W0 - x, x - W1, 0);
  const dz = Math.max(N0 - z, z - N1, 0);
  return Math.max(dx, dz);
};

/** Blocky 8×8 two-tone patches — large calm fields, never per-voxel noise. */
const patch = (x: number, z: number): number =>
  ((((x >> 3) * 73856093) ^ ((z >> 3) * 19349663)) >>> 0) & 1;

/** Banded masonry: courses cycle dark / mid / light / mid. */
const courseStone = (y: number): number =>
  y % 4 === 1 ? STONE_DARK : y % 4 === 3 ? STONE_LIGHT : STONE_MID;

/** Moss test along a wall run: contiguous 2-cell tufts every 9 cells. */
const mossRun = (i: number, salt: number): boolean => (i + salt) % 9 < 2;

// ── hip roofs: complete ramp rings + corner wedges, slab tip ────────────────
const hipRing = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  rgb: number,
): void => {
  if (x0 === x1 && z0 === z1) {
    ctx.set(x0, y, z0, M, rgb, SHAPE_SLAB_BOTTOM); // pyramid tip
    return;
  }
  ctx.set(x0, y, z0, M, rgb, SHAPE_CORNER_PXPZ);
  ctx.set(x1, y, z0, M, rgb, SHAPE_CORNER_NXPZ);
  ctx.set(x0, y, z1, M, rgb, SHAPE_CORNER_PXNZ);
  ctx.set(x1, y, z1, M, rgb, SHAPE_CORNER_NXNZ);
  for (let x = x0 + 1; x <= x1 - 1; x++) {
    ctx.set(x, y, z0, M, rgb, SHAPE_RAMP_PZ);
    ctx.set(x, y, z1, M, rgb, SHAPE_RAMP_NZ);
  }
  for (let z = z0 + 1; z <= z1 - 1; z++) {
    ctx.set(x0, y, z, M, rgb, SHAPE_RAMP_PX);
    ctx.set(x1, y, z, M, rgb, SHAPE_RAMP_NX);
  }
};

const hipRoof = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  yBase: number,
): void => {
  for (let lvl = 0; ; lvl++) {
    const rgb = lvl === 0 ? SLATE_DARK : lvl % 2 === 1 ? SLATE_MID : SLATE_LIGHT;
    hipRing(ctx, x0 + lvl, z0 + lvl, x1 - lvl, z1 - lvl, yBase + lvl, rgb);
    if (x1 - x0 - 2 * lvl <= 1 || z1 - z0 - 2 * lvl <= 1) return;
  }
};

// ── battlements: continuous outward-flush VSLAB run + alternating teeth ─────
const merlonsAlongZ = (
  ctx: SceneCtx,
  x: number,
  z0: number,
  z1: number,
  shape: number,
  y: number,
): void => {
  for (let z = z0; z <= z1; z++) {
    ctx.set(x, y, z, M, STONE_LIGHT, shape);
    if ((z & 1) === 0) ctx.set(x, y + 1, z, M, STONE_LIGHT, shape);
  }
};

const merlonsAlongX = (
  ctx: SceneCtx,
  z: number,
  x0: number,
  x1: number,
  shape: number,
  y: number,
): void => {
  for (let x = x0; x <= x1; x++) {
    ctx.set(x, y, z, M, STONE_LIGHT, shape);
    if ((x & 1) === 0) ctx.set(x, y + 1, z, M, STONE_LIGHT, shape);
  }
};

// ── build phases ────────────────────────────────────────────────────────────
const buildGroundAndMoat = (ctx: SceneCtx): void => {
  for (let x = 0; x < ctx.sx; x++) {
    for (let z = 0; z < ctx.sz; z++) {
      const d = moatDist(x, z);
      if (d >= 5 && d <= 7) {
        ctx.set(x, 0, z, CLS_WATER, MOAT_WATER); // moat channel, 3 wide
      } else if (d === 4 || d === 8) {
        ctx.set(x, 0, z, M, STONE_MID); // stone banks, both sides
        ctx.set(x, 1, z, M, STONE_LIGHT); // raised rim — water one level down
      } else if (x > W0 + 1 && x < W1 - 1 && z > N0 + 1 && z < N1 - 1) {
        ctx.set(x, 0, z, M, patch(x, z) ? COURT_LIGHT : COURT_DARK); // courtyard
      } else {
        ctx.set(x, 0, z, M, patch(x, z) ? GRASS_LIGHT : GRASS_DARK); // meadow
      }
    }
  }

  // dirt road from the meadow edge to the drawbridge (recolor only)
  for (let x = 76; x <= 93; x++)
    for (let z = GATE_Z0; z <= GATE_Z1; z++) ctx.set(x, 0, z, M, DIRT_PATH);

  // cobbled lane: gate → courtyard center → keep door
  for (let x = 45; x <= 63; x++)
    for (let z = GATE_Z0; z <= GATE_Z1; z++) ctx.set(x, 0, z, M, STONE_DARK);
  for (let x = 45; x <= 47; x++) for (let z = 53; z <= 61; z++) ctx.set(x, 0, z, M, STONE_DARK);
};

const buildCurtainWall = (ctx: SceneCtx): void => {
  for (let y = 1; y <= WALL_TOP; y++) {
    const rgb = courseStone(y);
    ctx.box(W0, y, N0, W0 + 1, y, N1, M, rgb); // west
    ctx.box(W1 - 1, y, N0, W1, y, N1, M, rgb); // east
    ctx.box(W0, y, N0, W1, y, N0 + 1, M, rgb); // north
    ctx.box(W0, y, N1 - 1, W1, y, N1, M, rgb); // south
  }

  // merlon runs: continuous VSLAB parapet at y9, teeth at y10, outward-flush,
  // spanning tower-to-tower on every wall (east run breaks for the gatehouse)
  merlonsAlongZ(ctx, W0, 32, 71, SHAPE_VSLAB_NX, WALL_TOP + 1);
  merlonsAlongZ(ctx, W1, 32, GH_Z0 - 1, SHAPE_VSLAB_PX, WALL_TOP + 1);
  merlonsAlongZ(ctx, W1, GH_Z1 + 1, 71, SHAPE_VSLAB_PX, WALL_TOP + 1);
  merlonsAlongX(ctx, N0, 24, 63, SHAPE_VSLAB_NZ, WALL_TOP + 1);
  merlonsAlongX(ctx, N1, 24, 63, SHAPE_VSLAB_PZ, WALL_TOP + 1);

  // wall stair to the walkway: paired ramps (2 wide), solid risers beneath
  for (let i = 0; i <= 7; i++) {
    const x = 46 + i;
    const yTop = 1 + i;
    if (yTop > 1) ctx.box(x, 1, 30, x, yTop - 1, 31, M, STONE_DARK);
    ctx.set(x, yTop, 30, M, STONE_MID, SHAPE_RAMP_PX);
    ctx.set(x, yTop, 31, M, STONE_MID, SHAPE_RAMP_PX);
  }
};

const buildTower = (ctx: SceneCtx, cx: number, cz: number): void => {
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > 14.5) continue; // round-ish 7-wide shaft
      const x = cx + dx;
      const z = cz + dz;
      for (let y = 1; y <= WALL_TOP; y++) ctx.set(x, y, z, M, courseStone(y));
      for (let y = WALL_TOP + 1; y <= TOWER_TOP - 1; y++) {
        if (d2 > 6.5) ctx.set(x, y, z, M, courseStone(y)); // hollow upper shaft
      }
      ctx.set(x, TOWER_TOP, z, M, STONE_DARK); // sealed deck under the cap
    }
  }
  // full hipped slate cap, one-cell eave overhang: 9×9 → 7 → 5 → 3 → slab tip
  hipRoof(ctx, cx - 4, cz - 4, cx + 4, cz + 4, TOWER_TOP + 1);
};

const buildTowerBanners = (ctx: SceneCtx): void => {
  // colored VSLAB pairs hung flush on the camera-facing tower walls
  const pair = (x: number, z: number, shape: number, rgb: number): void => {
    ctx.set(x, 9, z, M, rgb, shape);
    ctx.set(x, 10, z, M, rgb, shape);
  };
  for (const cz of [N0, N1]) {
    pair(W1 + 4, cz - 1, SHAPE_VSLAB_NX, BANNER_RED); // east faces
    pair(W1 + 4, cz + 1, SHAPE_VSLAB_NX, BANNER_GOLD);
  }
  for (const cx of [W0, W1]) {
    pair(cx - 1, N0 - 4, SHAPE_VSLAB_PZ, BANNER_GOLD); // north faces
    pair(cx + 1, N0 - 4, SHAPE_VSLAB_PZ, BANNER_RED);
  }
};

const buildGatehouse = (ctx: SceneCtx): void => {
  for (let y = 1; y <= GH_TOP; y++) ctx.box(GH_X0, y, GH_Z0, GH_X1, y, GH_Z1, M, courseStone(y));

  // arched tunnel: 3 wide, sides 3 tall, crown 4 tall along the full passage
  for (let x = GH_X0; x <= GH_X1; x++) {
    for (let z = GATE_Z0; z <= GATE_Z1; z++) {
      for (let y = 1; y <= 3; y++) ctx.clear(x, y, z);
      ctx.set(x, 0, z, M, STONE_DARK); // cobbled passage floor
    }
    ctx.clear(x, 4, GATE_Z0 + 1); // arch crown, center column only
  }

  // half-lowered portcullis: metal panel screen just behind the front wall
  for (let z = GATE_Z0; z <= GATE_Z1; z++) {
    const top = z === GATE_Z0 + 1 ? 4 : 3;
    for (let y = 2; y <= top; y++) ctx.set(GH_X1 - 1, y, z, CLS_METAL, IRON, SHAPE_VSLAB_PX);
  }

  // dressed gate frame, lanterns, and arrow slits on the front face
  ctx.box(GH_X1, 1, GATE_Z0 - 1, GH_X1, 5, GATE_Z0 - 1, M, STONE_DARK);
  ctx.box(GH_X1, 1, GATE_Z1 + 1, GH_X1, 5, GATE_Z1 + 1, M, STONE_DARK);
  ctx.box(GH_X1, 5, GATE_Z0 - 1, GH_X1, 5, GATE_Z1 + 1, M, STONE_DARK);
  ctx.set(GH_X1, 4, GATE_Z0, M, STONE_DARK);
  ctx.set(GH_X1, 4, GATE_Z1, M, STONE_DARK);
  ctx.set(GH_X1, 6, GATE_Z0 - 1, MaterialClass.Emissive, TORCH_GLOW);
  ctx.set(GH_X1, 6, GATE_Z1 + 1, MaterialClass.Emissive, TORCH_GLOW);
  ctx.box(GH_X1, 7, GH_Z0 + 1, GH_X1, 8, GH_Z0 + 1, M, SLIT_DARK);
  ctx.box(GH_X1, 7, GH_Z1 - 1, GH_X1, 8, GH_Z1 - 1, M, SLIT_DARK);

  // gatehouse battlements: runs on all four edges, cube posts at the corners
  merlonsAlongZ(ctx, GH_X1, GH_Z0, GH_Z1, SHAPE_VSLAB_PX, GH_TOP + 1);
  merlonsAlongZ(ctx, GH_X0, GH_Z0, GH_Z1, SHAPE_VSLAB_NX, GH_TOP + 1);
  merlonsAlongX(ctx, GH_Z0, GH_X0 + 1, GH_X1 - 1, SHAPE_VSLAB_NZ, GH_TOP + 1);
  merlonsAlongX(ctx, GH_Z1, GH_X0 + 1, GH_X1 - 1, SHAPE_VSLAB_PZ, GH_TOP + 1);
  for (const x of [GH_X0, GH_X1])
    for (const z of [GH_Z0, GH_Z1]) ctx.box(x, GH_TOP + 1, z, x, GH_TOP + 2, z, M, STONE_LIGHT);

  // drawbridge: slab deck across the moat, resting on the far bank
  for (let x = 72; x <= 75; x++)
    for (let z = GATE_Z0; z <= GATE_Z1; z++) ctx.set(x, 1, z, M, WOOD, SHAPE_SLAB_BOTTOM);
};

const buildKeep = (ctx: SceneCtx): void => {
  // battered plinth: complete ramp ring with corner wedges, solid heart
  hipRing(ctx, KX0 - 1, KZ0 - 1, KX1 + 1, KZ1 + 1, 1, STONE_DARK);
  ctx.box(KX0, 1, KZ0, KX1, 1, KZ1, M, STONE_DARK);

  // shell walls with banded courses and laddered corner quoins
  for (let y = 2; y <= KEEP_TOP; y++) {
    const rgb = courseStone(y);
    ctx.box(KX0, y, KZ0, KX1, y, KZ0, M, rgb);
    ctx.box(KX0, y, KZ1, KX1, y, KZ1, M, rgb);
    ctx.box(KX0, y, KZ0 + 1, KX0, y, KZ1 - 1, M, rgb);
    ctx.box(KX1, y, KZ0 + 1, KX1, y, KZ1 - 1, M, rgb);
    const quoin = y % 2 === 0 ? STONE_LIGHT : STONE_DARK;
    ctx.set(KX0, y, KZ0, M, quoin);
    ctx.set(KX1, y, KZ0, M, quoin);
    ctx.set(KX0, y, KZ1, M, quoin);
    ctx.set(KX1, y, KZ1, M, quoin);
  }

  // framed timber door facing the courtyard lane
  ctx.box(KX1, 2, 58, KX1, 5, 58, M, STONE_DARK);
  ctx.box(KX1, 2, 61, KX1, 5, 61, M, STONE_DARK);
  ctx.box(KX1, 5, 59, KX1, 5, 60, M, STONE_DARK);
  ctx.box(KX1, 2, 59, KX1, 4, 60, M, WOOD_DARK);

  // windows: glass pairs low, one warm lit pair high on the camera face
  const win = (x: number, z0: number, y0: number, cls: number, rgb: number): void => {
    ctx.box(x, y0, z0, x, y0 + 1, z0 + 1, cls, rgb);
    ctx.box(x, y0 - 1, z0 - 1, x, y0 - 1, z0 + 2, M, STONE_DARK); // sill
    ctx.box(x, y0 + 2, z0 - 1, x, y0 + 2, z0 + 2, M, STONE_DARK); // lintel
  };
  win(KX1, 56, 9, MaterialClass.Glass, GLASS_PANE);
  win(KX1, 62, 9, MaterialClass.Glass, GLASS_PANE);
  win(KX1, 56, 14, MaterialClass.Emissive, WINDOW_GLOW);
  win(KX1, 62, 14, MaterialClass.Glass, GLASS_PANE);
  for (const x0 of [33, 39]) {
    ctx.box(x0, 9, KZ0, x0 + 1, 10, KZ0, MaterialClass.Glass, GLASS_PANE);
    ctx.box(x0, 14, KZ0, x0 + 1, 15, KZ0, MaterialClass.Glass, GLASS_PANE);
  }

  // hip roof with a one-cell eave: 16×16 rings up to the 2×2 wedge crown
  hipRoof(ctx, KX0 - 1, KZ0 - 1, KX1 + 1, KZ1 + 1, KEEP_TOP + 1);

  // banner poles: a gold pennant at the apex, paired poles flanking the door
  ctx.box(36, 28, 60, 36, 31, 60, CLS_METAL, IRON);
  ctx.set(36, 30, 61, M, BANNER_GOLD, SHAPE_VSLAB_NZ);
  ctx.set(36, 31, 61, M, BANNER_GOLD, SHAPE_VSLAB_NZ);
  for (const [z, rgb] of [
    [57, BANNER_RED],
    [62, BANNER_GOLD],
  ] as const) {
    ctx.box(46, 1, z, 46, 8, z, M, WOOD_DARK);
    ctx.set(47, 7, z, M, rgb, SHAPE_VSLAB_NX);
    ctx.set(47, 8, z, M, rgb, SHAPE_VSLAB_NX);
  }
};

const buildCourtyard = (ctx: SceneCtx): void => {
  // well: stone rim ring, water sunk one level, mini hip canopy on posts
  ctx.box(55, 1, 39, 57, 1, 41, M, STONE_LIGHT);
  ctx.clear(56, 1, 40); // open shaft inside the rim
  ctx.set(56, 0, 40, CLS_WATER, WELL_WATER); // water one level below the rim
  for (const px of [55, 57]) for (const pz of [39, 41]) ctx.box(px, 2, pz, px, 4, pz, M, WOOD_DARK);
  hipRoof(ctx, 55, 39, 57, 41, 5);

  // market stall: posts, plank counter, slab roof, striped VSLAB awning run
  for (const px of [50, 53]) for (const pz of [61, 63]) ctx.box(px, 1, pz, px, 3, pz, M, WOOD_DARK);
  ctx.box(50, 1, 61, 53, 1, 61, M, WOOD);
  ctx.set(51, 2, 61, M, BANNER_GOLD);
  ctx.set(52, 2, 61, M, BANNER_RED);
  ctx.box(49, 4, 60, 54, 4, 64, M, WOOD_DARK, SHAPE_SLAB_BOTTOM);
  for (let x = 50; x <= 53; x++)
    ctx.set(x, 3, 60, M, x % 2 === 0 ? BANNER_RED : AWNING_CREAM, SHAPE_VSLAB_PZ);

  // crates by the gate and two torch poles lighting the lane
  ctx.box(60, 1, 55, 61, 1, 56, M, WOOD);
  ctx.set(60, 2, 55, M, WOOD_DARK);
  for (const [tx, tz] of [
    [47, 48],
    [56, 58],
  ] as const) {
    ctx.box(tx, 1, tz, tx, 3, tz, M, WOOD_DARK);
    ctx.set(tx, 4, tz, MaterialClass.Emissive, TORCH_GLOW);
  }
};

const buildMossPass = (ctx: SceneCtx): void => {
  // weathering at the waterline: contiguous 2-cell moss tufts on base courses
  for (let z = N0; z <= N1; z++) {
    if (mossRun(z, 0)) ctx.set(W0, 1, z, M, MOSS);
    if (mossRun(z, 4)) ctx.set(W1, 1, z, M, MOSS);
  }
  for (let x = W0; x <= W1; x++) {
    if (mossRun(x, 2)) ctx.set(x, 1, N0, M, MOSS);
    if (mossRun(x, 6)) ctx.set(x, 1, N1, M, MOSS);
  }
  // bank rim moss, aligned with each straight edge of the ring
  for (let x = 0; x < ctx.sx; x++) {
    for (let z = 0; z < ctx.sz; z++) {
      const d = moatDist(x, z);
      if (d !== 4 && d !== 8) continue;
      const dx = Math.max(W0 - x, x - W1, 0);
      const dz = Math.max(N0 - z, z - N1, 0);
      if (dx >= dz ? mossRun(z, 3) : mossRun(x, 7)) ctx.set(x, 1, z, M, MOSS);
    }
  }
};

// ── scene ───────────────────────────────────────────────────────────────────
const build = (ctx: SceneCtx): void => {
  buildGroundAndMoat(ctx);
  buildCurtainWall(ctx);
  for (const [cx, cz] of TOWER_XZ) buildTower(ctx, cx, cz);
  buildTowerBanners(ctx);
  buildGatehouse(ctx);
  buildKeep(ctx);
  buildCourtyard(ctx);
  buildMossPass(ctx);
};

export const scene: SceneSpec = {
  id: "castle-keep",
  name: "Castle Keep",
  blurb: "stone walls and banner-lined ramparts",
  cx: 3,
  cy: 2,
  cz: 3,
  build,
};
