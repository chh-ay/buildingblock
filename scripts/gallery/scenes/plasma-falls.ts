/**
 * Plasma Falls — the shader showcase.
 *
 * A deep six-level canyon drops from a back plateau (rim y=18) to a calm
 * valley floor toward the hero camera (+x/-z). Terraces bunch tightly around
 * the central corridor so the cut reads as a canyon, and fan wide toward the
 * rims. Two animated flows run the corridor side by side: a three-voxel-wide
 * CLS_WATER cascade stepping through three solid-edged basins into a deep
 * slot, and a CLS_PLASMA stream born in a glowing fissure under a metal-caged
 * monolith. A tributary cascade pours off the west mesa in three camera-facing
 * sheets and joins the slot. Everything converges in one shared plunge pool
 * and swirls there, side by side. A CLS_METAL walkway spans the pool with a
 * glass observation pod slung beneath, and an emissive-marked switchback ramp
 * path climbs the east benches to the deck.
 *
 * Terrain is a hand-shaped rectangular terrace field; every cliff edge is
 * beveled for its entire contour by one deterministic pass (ramps along the
 * straights, outer corners on convex turns, inner wedges closing concave
 * ones), so no wedge ever stands alone. Walls are cool dark strata; walkable
 * caps are light warm grey for a strong value split.
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
  SHAPE_VSLAB_NZ,
  SHAPE_VSLAB_PZ,
} from "../scene";

// ── palette ──────────────────────────────────────────────────────────────────

// Cool dark wall strata (deep / mid / high), each with a darker bedding band.
const STRATA = [
  [0x1a1726, 0x14111d],
  [0x27233a, 0x1f1c2f],
  [0x36324e, 0x2c2940],
] as const;
// Warm light caps per terrace level — the value counterpoint to the walls.
const CAPS = [0x6f665a, 0x7d7464, 0x8c826e, 0x9b9078, 0xab9f83, 0xbcb091] as const;
const FLOOR_CARVED = 0x12101c; // basin, channel and pool beds under the fluids
const PAVE = 0x8a7c66; // switchback treads, landings, monolith plinth
const PAVE_FILL = 0x57503f; // masonry under the treads

const WATER_DEEP = 0x1f6fa3;
const WATER_RUN = 0x3fa9d6;
const WATER_FOAM = 0xa5e6f6;
const PLASMA_CORE = 0x7d1fd0;
const PLASMA_RUN = 0xc050ff;
const PLASMA_HOT = 0xeaa4ff;
const METAL_LIGHT = 0xb9c1cc;
const METAL_DARK = 0x6f7a89;
const GLASS = 0xbfe9f6;
const LAMP = 0xffc46e;

const { Matte, Glass, Emissive } = MaterialClass;

// ── terrace field ─────────────────────────────────────────────────────────────
// Six level tops. Downstream thresholds bunch inside the corridor (x 36..60)
// and spread outside it; lateral bench rectangles stack the canyon walls.
// Every region nests inside the level below it, so steps are always 1 level.

const TOPS = [2, 5, 8, 11, 14, 18] as const;
const CORRIDOR_THR = [26, 34, 44, 56, 70] as const; // L1..L5, x 36..60
const OUTER_THR = [26, 38, 52, 68, 84] as const;

const levelAt = (x: number, z: number): number => {
  const thr = x >= 36 && x <= 60 ? CORRIDOR_THR : OUTER_THR;
  let lvl = 0;
  for (let i = 0; i < 5; i++) if (z >= thr[i]) lvl = i + 1;
  // West wall benches, climbing toward the back-left mesa.
  if (x <= 34 && z >= 6) lvl = Math.max(lvl, 1);
  if (x <= 28 && z >= 12) lvl = Math.max(lvl, 2);
  if (x <= 22 && z >= 20) lvl = Math.max(lvl, 3);
  if (x <= 15 && z >= 30) lvl = Math.max(lvl, 4);
  if (x <= 8 && z >= 42) lvl = Math.max(lvl, 5);
  // East wall benches, kept lower so the hero camera sees into the canyon.
  if (x >= 68 && z >= 8) lvl = Math.max(lvl, 1);
  if (x >= 74 && z >= 14) lvl = Math.max(lvl, 2);
  if (x >= 80 && z >= 24) lvl = Math.max(lvl, 3);
  if (x >= 87 && z >= 36) lvl = Math.max(lvl, 4);
  return lvl;
};
const topAt = (x: number, z: number): number => TOPS[levelAt(x, z)];

// ── carved waterways ──────────────────────────────────────────────────────────
// Returns the rock-bed height of a carved column, or -1 for solid ground.
// Fluid always sits at bed+1, one voxel below the surrounding rim.

const inRect = (x: number, z: number, x0: number, z0: number, x1: number, z1: number): boolean =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;

const carveAt = (x: number, z: number): number => {
  // Shared plunge pool, the two fall mouths breaching its back rim, and the
  // outflow brook running off the front of the world.
  if (inRect(x, z, 37, 7, 61, 24)) return 0;
  if ((x >= 41 && x <= 43) || (x >= 53 && x <= 54)) {
    if (z === 25) return 0;
  }
  if ((x === 47 || x === 48) && z <= 6) return 0;
  // Water cascade: spring basin A, bench basins B and C, then the deep slot.
  if (inRect(x, z, 39, 75, 45, 79)) return 16; // basin A (plateau spring)
  if (x >= 41 && x <= 43 && z >= 70 && z <= 74) return 16; // channel A
  if (inRect(x, z, 39, 64, 45, 69)) return 12; // basin B
  if (x >= 41 && x <= 43 && z >= 56 && z <= 63) return 12; // channel B
  if (inRect(x, z, 39, 49, 45, 55)) return 9; // basin C
  if (x >= 41 && x <= 43 && z >= 44 && z <= 48) return 9; // channel C
  if (x >= 41 && x <= 43 && z >= 26 && z <= 43) return 3; // slot run to the pool
  // Plasma flow: wide fissure on the plateau, then a parallel channel run.
  if (inRect(x, z, 51, 76, 56, 80)) return 16; // glowing fissure
  if (x >= 53 && x <= 54 && z >= 70 && z <= 75) return 16;
  if (x >= 53 && x <= 54 && z >= 56 && z <= 69) return 12;
  if (x >= 53 && x <= 54 && z >= 44 && z <= 55) return 9;
  if (x >= 53 && x <= 54 && z >= 26 && z <= 43) return 3;
  // Tributary off the west mesa: pocket spring, three runouts stepping east.
  if (inRect(x, z, 10, 34, 13, 37)) return 12; // pocket spring basin
  if (x >= 14 && x <= 15 && z >= 35 && z <= 36) return 12; // rim notch
  if (x >= 16 && x <= 22 && z >= 35 && z <= 36) return 9; // bench runout
  if (x >= 23 && x <= 28 && z >= 35 && z <= 36) return 6; // bench runout
  if (x >= 29 && x <= 40 && z >= 35 && z <= 36) return 3; // joins the slot
  return -1;
};

// Columns kept square because a built landing merges flush with the cliff top.
const SQUARED: Record<string, true> = {
  "68,13": true,
  "68,14": true,
  "68,15": true,
  "74,21": true,
  "74,22": true,
  "74,23": true,
};

// ── contour bevel pass ────────────────────────────────────────────────────────
// One rule for the whole map: a cliff-top voxel ramps toward its single lower
// side, turns convex corners with CORNER_*, and closes concave turns with
// INNER_*. Columns beside carved channels stay square so the waterways read as
// crisp solid-edged cuts.

const topShapeAt = (x: number, z: number): number => {
  if (SQUARED[`${x},${z}`]) return SHAPE_CUBE;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (carveAt(x + dx, z + dz) >= 0) return SHAPE_CUBE;
    }
  }
  const t = topAt(x, z);
  const at = (xx: number, zz: number): number =>
    xx < 0 || xx > 95 || zz < 0 || zz > 95 ? t : topAt(xx, zz);
  const px = at(x + 1, z) < t;
  const nx = at(x - 1, z) < t;
  const pz = at(x, z + 1) < t;
  const nz = at(x, z - 1) < t;
  const sides = (px ? 1 : 0) + (nx ? 1 : 0) + (pz ? 1 : 0) + (nz ? 1 : 0);
  if (sides === 1) {
    if (px) return SHAPE_RAMP_NX;
    if (nx) return SHAPE_RAMP_PX;
    if (pz) return SHAPE_RAMP_NZ;
    return SHAPE_RAMP_PZ;
  }
  if (sides === 2) {
    if (px && nz) return SHAPE_CORNER_NXPZ;
    if (px && pz) return SHAPE_CORNER_NXNZ;
    if (nx && nz) return SHAPE_CORNER_PXPZ;
    if (nx && pz) return SHAPE_CORNER_PXNZ;
    return SHAPE_CUBE; // opposite-side ridge: layout never produces one
  }
  if (sides === 0) {
    const dpn = at(x + 1, z - 1) < t;
    const dpp = at(x + 1, z + 1) < t;
    const dnn = at(x - 1, z - 1) < t;
    const dnp = at(x - 1, z + 1) < t;
    if ((dpn ? 1 : 0) + (dpp ? 1 : 0) + (dnn ? 1 : 0) + (dnp ? 1 : 0) !== 1) return SHAPE_CUBE;
    if (dpn) return SHAPE_INNER_NXPZ;
    if (dpp) return SHAPE_INNER_NXNZ;
    if (dnn) return SHAPE_INNER_PXPZ;
    return SHAPE_INNER_PXNZ;
  }
  return SHAPE_CUBE;
};

const strataRgb = (y: number): number => {
  const s = y <= 4 ? 0 : y <= 10 ? 1 : 2;
  return STRATA[s][y % 5 === 4 ? 1 : 0];
};

// ── phase 1: terraced canyon ──────────────────────────────────────────────────
// Skin fill: each column rises to its own top and plates every face a lower
// neighbour exposes; world-border columns fill to bedrock so the cut sides of
// the diorama stay solid.

const buildTerrain = (ctx: SceneCtx): void => {
  const heightOf = (xx: number, zz: number): number => {
    if (xx < 0 || xx > 95 || zz < 0 || zz > 95) return -1;
    const f = carveAt(xx, zz);
    return f >= 0 ? f : topAt(xx, zz);
  };
  for (let z = 0; z < 96; z++) {
    for (let x = 0; x < 96; x++) {
      const bed = carveAt(x, z);
      const top = bed >= 0 ? bed : topAt(x, z);
      const lo = Math.min(
        heightOf(x + 1, z),
        heightOf(x - 1, z),
        heightOf(x, z + 1),
        heightOf(x, z - 1),
      );
      const from = Math.max(0, Math.min(lo + 1, top));
      for (let y = from; y < top; y++) ctx.set(x, y, z, Matte, strataRgb(y));
      if (bed >= 0) ctx.set(x, top, z, Matte, FLOOR_CARVED);
      else ctx.set(x, top, z, Matte, CAPS[levelAt(x, z)], topShapeAt(x, z));
    }
  }
};

// ── phase 2: water cascade ────────────────────────────────────────────────────
// Three-wide water through three solid-edged basins, foam fall sheets pinned
// to the camera-facing cliffs, then a six-tall plunge into the slot.

const buildWater = (ctx: SceneCtx): void => {
  ctx.box(39, 17, 75, 45, 17, 79, CLS_WATER, WATER_DEEP); // basin A
  ctx.box(41, 17, 70, 43, 17, 74, CLS_WATER, WATER_RUN); // channel A
  ctx.box(41, 14, 69, 43, 17, 69, CLS_WATER, WATER_FOAM); // fall A sheet

  ctx.box(39, 13, 64, 45, 13, 69, CLS_WATER, WATER_DEEP); // basin B
  ctx.box(40, 13, 68, 44, 13, 69, CLS_WATER, WATER_FOAM); // impact churn
  ctx.box(41, 13, 56, 43, 13, 63, CLS_WATER, WATER_RUN); // channel B
  ctx.box(41, 11, 55, 43, 13, 55, CLS_WATER, WATER_FOAM); // fall B sheet

  ctx.box(39, 10, 49, 45, 10, 55, CLS_WATER, WATER_DEEP); // basin C
  ctx.box(40, 10, 54, 44, 10, 55, CLS_WATER, WATER_FOAM); // impact churn
  ctx.box(41, 10, 44, 43, 10, 48, CLS_WATER, WATER_RUN); // channel C
  ctx.box(41, 5, 43, 43, 10, 43, CLS_WATER, WATER_FOAM); // six-tall slot fall

  ctx.box(41, 4, 26, 43, 4, 42, CLS_WATER, WATER_RUN); // slot run
  ctx.box(41, 1, 25, 43, 1, 25, CLS_WATER, WATER_RUN); // pool mouth
  ctx.box(41, 2, 25, 43, 4, 25, CLS_WATER, WATER_FOAM); // final plunge
};

// ── phase 3: plasma flow ──────────────────────────────────────────────────────
// Born hot in the wide fissure, running parallel to the water one bench over,
// with its own six-tall glowing drop into the slot.

const buildPlasma = (ctx: SceneCtx): void => {
  ctx.box(51, 17, 76, 56, 17, 80, CLS_PLASMA, PLASMA_HOT); // fissure glow
  ctx.box(53, 17, 70, 54, 17, 75, CLS_PLASMA, PLASMA_RUN);
  ctx.box(53, 14, 69, 54, 17, 69, CLS_PLASMA, PLASMA_HOT); // upper fall
  ctx.box(53, 13, 56, 54, 13, 68, CLS_PLASMA, PLASMA_RUN);
  ctx.box(53, 11, 55, 54, 13, 55, CLS_PLASMA, PLASMA_HOT); // mid fall
  ctx.box(53, 10, 44, 54, 10, 54, CLS_PLASMA, PLASMA_RUN);
  ctx.box(53, 5, 43, 54, 10, 43, CLS_PLASMA, PLASMA_HOT); // six-tall slot fall
  ctx.box(53, 4, 26, 54, 4, 42, CLS_PLASMA, PLASMA_RUN);
  ctx.box(53, 1, 25, 54, 1, 25, CLS_PLASMA, PLASMA_RUN); // pool mouth
  ctx.box(53, 2, 25, 54, 4, 25, CLS_PLASMA, PLASMA_HOT); // final plunge
};

// ── phase 4: tributary cascade ────────────────────────────────────────────────
// A pocket spring on the west mesa pours east in three sheets — every one on
// a +x cliff face, square to the hero camera — and joins the slot run.

const buildTributary = (ctx: SceneCtx): void => {
  ctx.box(10, 13, 34, 13, 13, 37, CLS_WATER, WATER_DEEP); // pocket spring
  ctx.box(14, 13, 35, 15, 13, 36, CLS_WATER, WATER_RUN); // rim notch
  ctx.box(16, 11, 35, 16, 13, 36, CLS_WATER, WATER_FOAM); // sheet one
  ctx.box(17, 10, 35, 22, 10, 36, CLS_WATER, WATER_RUN);
  ctx.box(23, 8, 35, 23, 10, 36, CLS_WATER, WATER_FOAM); // sheet two
  ctx.box(24, 7, 35, 28, 7, 36, CLS_WATER, WATER_RUN);
  ctx.box(29, 5, 35, 29, 7, 36, CLS_WATER, WATER_FOAM); // sheet three
  ctx.box(30, 4, 35, 40, 4, 36, CLS_WATER, WATER_RUN); // runout into the slot
};

// ── phase 5: shared plunge pool ───────────────────────────────────────────────
// One sheet of deep water, a slab curb on the rim, a plasma arm spiralling in
// from its fall mouth with a foam arc swirling beside it, and the outflow
// brook leading the eye out of frame.

// Interleaved x,z cell pairs at water level (y=1), traced by hand.
const PLASMA_ARM: readonly number[] = [
  53, 24, 54, 24, 53, 23, 54, 23, 52, 22, 53, 22, 51, 21, 52, 21, 50, 20, 51, 20, 49, 19, 50, 19,
  48, 18, 49, 18, 47, 17, 48, 17, 46, 16, 47, 16, 46, 15, 47, 15, 46, 14, 47, 14, 47, 13, 48, 13,
  48, 12, 49, 12, 49, 11, 50, 11, 50, 10, 51, 10,
];

const FOAM_ARC: readonly number[] = [
  42, 23, 43, 23, 43, 22, 44, 22, 44, 21, 45, 21, 44, 20, 45, 20, 44, 19, 45, 19, 44, 18, 45, 18,
];

const buildPool = (ctx: SceneCtx): void => {
  ctx.box(37, 1, 7, 61, 1, 24, CLS_WATER, WATER_DEEP);
  for (let i = 0; i < PLASMA_ARM.length; i += 2) {
    ctx.set(PLASMA_ARM[i], 1, PLASMA_ARM[i + 1], CLS_PLASMA, i < 8 ? PLASMA_HOT : PLASMA_RUN);
  }
  for (let i = 0; i < FOAM_ARC.length; i += 2) {
    ctx.set(FOAM_ARC[i], 1, FOAM_ARC[i + 1], CLS_WATER, WATER_FOAM);
  }
  ctx.box(47, 1, 0, 48, 1, 6, CLS_WATER, WATER_RUN); // outflow brook

  // Solid curb ring on the pool rim, broken only where the falls come down
  // and where the brook leaves.
  for (let x = 36; x <= 62; x++) {
    for (const z of [6, 25]) {
      if (carveAt(x, z) < 0) ctx.set(x, 3, z, Matte, CAPS[1], SHAPE_SLAB_BOTTOM);
    }
  }
  for (let z = 7; z <= 24; z++) {
    ctx.set(36, 3, z, Matte, CAPS[1], SHAPE_SLAB_BOTTOM);
    ctx.set(62, 3, z, Matte, CAPS[1], SHAPE_SLAB_BOTTOM);
  }
};

// ── phase 6: observation walkway ──────────────────────────────────────────────
// Slab deck from bench to bench across the pool, unbroken VSLAB railing runs,
// metal pylon pairs (one standing in the pool), and lamps at both ends.

const DECK_Y = 9;

const buildWalkway = (ctx: SceneCtx): void => {
  ctx.box(29, DECK_Y, 15, 73, DECK_Y, 17, CLS_METAL, METAL_LIGHT, SHAPE_SLAB_BOTTOM);
  ctx.box(29, DECK_Y + 1, 15, 73, DECK_Y + 1, 15, CLS_METAL, METAL_DARK, SHAPE_VSLAB_NZ);
  ctx.box(29, DECK_Y + 1, 17, 73, DECK_Y + 1, 17, CLS_METAL, METAL_DARK, SHAPE_VSLAB_PZ);

  for (const [px, yFrom] of [
    [33, 6],
    [56, 2],
    [65, 3],
  ] as const) {
    ctx.box(px, yFrom, 15, px, DECK_Y - 1, 15, CLS_METAL, METAL_DARK);
    ctx.box(px, yFrom, 17, px, DECK_Y - 1, 17, CLS_METAL, METAL_DARK);
  }

  // End lamps replace the four corner railing panels.
  for (const [lx, lz] of [
    [29, 15],
    [29, 17],
    [73, 15],
    [73, 17],
  ] as const) {
    ctx.set(lx, DECK_Y + 1, lz, CLS_METAL, METAL_DARK);
    ctx.set(lx, DECK_Y + 2, lz, Emissive, LAMP);
  }
};

// ── phase 7: glass observation pod ────────────────────────────────────────────
// Slung beneath the deck between the two fall streams, lit from inside.

const buildPod = (ctx: SceneCtx): void => {
  ctx.box(46, 4, 15, 50, 4, 17, CLS_METAL, METAL_DARK, SHAPE_SLAB_TOP); // floor
  for (let z = 15; z <= 17; z++) {
    for (let x = 46; x <= 50; x++) {
      if (x === 46 || x === 50 || z === 15 || z === 17) {
        ctx.box(x, 5, z, x, 6, z, Glass, GLASS);
      }
    }
  }
  ctx.set(48, 5, 16, Emissive, LAMP); // cabin glow
  ctx.box(46, 7, 15, 50, 7, 17, CLS_METAL, METAL_LIGHT, SHAPE_SLAB_BOTTOM); // roof
  ctx.box(47, 7, 16, 49, 8, 16, CLS_METAL, METAL_DARK); // spine up to the deck
};

// ── phase 8: switchback ramp path ─────────────────────────────────────────────
// Two-wide masonry ramp runs climbing the east benches: floor -> first bench
// -> bench walk -> second run -> landing flush with the deck's east end.
// Emissive route markers pace the climb.

const marker = (ctx: SceneCtx, x: number, z: number, yBase: number): void => {
  ctx.set(x, yBase, z, Matte, PAVE_FILL);
  ctx.set(x, yBase + 1, z, Emissive, LAMP);
};

const buildSwitchback = (ctx: SceneCtx): void => {
  // Leg 1: valley floor (top 2) up to the first east bench (top 5).
  for (let z = 10; z <= 12; z++) {
    const yr = z - 7;
    for (let x = 66; x <= 67; x++) {
      if (yr > 3) ctx.box(x, 3, z, x, yr - 1, z, Matte, PAVE_FILL);
      ctx.set(x, yr, z, Matte, PAVE, SHAPE_RAMP_PZ);
    }
  }
  ctx.box(66, 3, 13, 67, 4, 15, Matte, PAVE_FILL); // landing core
  ctx.box(66, 5, 13, 68, 5, 15, Matte, PAVE); // landing tread, flush with bench

  // Leg 2: first bench (top 5) up to the second bench (top 8).
  for (let z = 18; z <= 20; z++) {
    const yr = z - 12;
    for (let x = 72; x <= 73; x++) {
      if (yr > 6) ctx.box(x, 6, z, x, yr - 1, z, Matte, PAVE_FILL);
      ctx.set(x, yr, z, Matte, PAVE, SHAPE_RAMP_PZ);
    }
  }
  ctx.box(72, 6, 21, 73, 7, 23, Matte, PAVE_FILL); // abutment core
  ctx.box(72, 8, 21, 74, 8, 23, Matte, PAVE); // tread, flush with the bench

  marker(ctx, 65, 10, 3); // trailhead
  marker(ctx, 66, 15, 6); // first landing
  marker(ctx, 70, 17, 6); // bench-walk turn
  marker(ctx, 72, 23, 9); // deck abutment
};

// ── phase 9: caged plasma monolith ────────────────────────────────────────────
// A beveled plinth behind the fissure, a metal cage of posts and rings, the
// plasma core rising through the cap to a four-corner pyramid tip.

const buildMonolith = (ctx: SceneCtx): void => {
  // Plinth ring: ramps along every side, corners closing the loop.
  ctx.box(52, 19, 83, 55, 19, 86, Matte, PAVE);
  ctx.box(52, 19, 82, 55, 19, 82, Matte, PAVE, SHAPE_RAMP_PZ);
  ctx.box(52, 19, 87, 55, 19, 87, Matte, PAVE, SHAPE_RAMP_NZ);
  ctx.box(51, 19, 83, 51, 19, 86, Matte, PAVE, SHAPE_RAMP_PX);
  ctx.box(56, 19, 83, 56, 19, 86, Matte, PAVE, SHAPE_RAMP_NX);
  ctx.set(51, 19, 82, Matte, PAVE, SHAPE_CORNER_PXPZ);
  ctx.set(56, 19, 82, Matte, PAVE, SHAPE_CORNER_NXPZ);
  ctx.set(56, 19, 87, Matte, PAVE, SHAPE_CORNER_NXNZ);
  ctx.set(51, 19, 87, Matte, PAVE, SHAPE_CORNER_PXNZ);

  // Core and cage.
  ctx.box(53, 20, 84, 54, 31, 85, CLS_PLASMA, PLASMA_CORE);
  for (const [cx, cz] of [
    [52, 83],
    [55, 83],
    [52, 86],
    [55, 86],
  ] as const) {
    ctx.box(cx, 20, cz, cx, 31, cz, CLS_METAL, METAL_DARK);
  }
  for (const ry of [23, 27]) {
    ctx.box(53, ry, 83, 54, ry, 83, CLS_METAL, METAL_LIGHT);
    ctx.box(53, ry, 86, 54, ry, 86, CLS_METAL, METAL_LIGHT);
    ctx.box(52, ry, 84, 52, ry, 85, CLS_METAL, METAL_LIGHT);
    ctx.box(55, ry, 84, 55, ry, 85, CLS_METAL, METAL_LIGHT);
  }

  // Cap ring with the core punching through, then the flame tip.
  for (let z = 83; z <= 86; z++) {
    for (let x = 52; x <= 55; x++) {
      const isCore = x >= 53 && x <= 54 && z >= 84 && z <= 85;
      if (!isCore) ctx.set(x, 32, z, CLS_METAL, METAL_LIGHT, SHAPE_SLAB_BOTTOM);
    }
  }
  ctx.box(53, 32, 84, 54, 33, 85, CLS_PLASMA, PLASMA_RUN);
  ctx.set(53, 34, 84, CLS_PLASMA, PLASMA_HOT, SHAPE_CORNER_PXPZ);
  ctx.set(54, 34, 84, CLS_PLASMA, PLASMA_HOT, SHAPE_CORNER_NXPZ);
  ctx.set(53, 34, 85, CLS_PLASMA, PLASMA_HOT, SHAPE_CORNER_PXNZ);
  ctx.set(54, 34, 85, CLS_PLASMA, PLASMA_HOT, SHAPE_CORNER_NXNZ);
};

// ── phase 10: foreground dressing ─────────────────────────────────────────────
// A few flat slab pads on the calm valley floor; nothing that fights the
// silhouette.

const buildForeground = (ctx: SceneCtx): void => {
  ctx.box(63, 3, 2, 65, 3, 4, Matte, CAPS[1], SHAPE_SLAB_BOTTOM);
  ctx.box(24, 3, 2, 26, 3, 4, Matte, CAPS[1], SHAPE_SLAB_BOTTOM);
  ctx.box(31, 3, 1, 32, 3, 2, Matte, CAPS[1], SHAPE_SLAB_BOTTOM);
};

// ── scene ─────────────────────────────────────────────────────────────────────

export const scene: SceneSpec = {
  id: "plasma-falls",
  name: "Plasma Falls",
  blurb: "animated shaders over carved terraces",
  cx: 3,
  cy: 2,
  cz: 3,
  build(ctx: SceneCtx): void {
    buildTerrain(ctx);
    buildWater(ctx);
    buildPlasma(ctx);
    buildTributary(ctx);
    buildPool(ctx);
    buildWalkway(ctx);
    buildPod(ctx);
    buildSwitchback(ctx);
    buildMonolith(ctx);
    buildForeground(ctx);
  },
};
