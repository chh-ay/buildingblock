/**
 * Sail Ship — a square-rigged sloop on open sea, composed for the hero camera
 * (azimuth -0.65 rad: viewer sits at +X/-Z, so the bow points -Z toward the
 * lens and the tall rig reads behind it).
 *
 * Layout (z runs stern→bow):
 *   z 63..60  transom + raised quarterdeck (rail ring, stern windows, lantern)
 *   z 59..36  midship, half-beam 5, planked freeboard + bulwark runs
 *   z 35..23  bow taper — each height step is a complete ramp run capped with
 *             corner wedges (never a lone wedge), descending 12 → 10
 *   z 22..21  proud stem post, then bowsprit reaching to z=16
 *   mast at z=40 carrying three staggered square sails + pennant
 */
import type { SceneCtx, SceneSpec } from "../scene";
import {
  CLS_METAL,
  CLS_WATER,
  MaterialClass,
  SHAPE_CORNER_NXPZ,
  SHAPE_CORNER_PXPZ,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_VSLAB_NX,
  SHAPE_VSLAB_NZ,
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
} from "../scene";

// ── palette ─────────────────────────────────────────────────────────────────

const WATER_DEEP = 0x2b5d70;
const WATER_LITE = 0x39798c;
const FOAM = 0xa8d8dc;

const KEEL = 0x3b2a1c;
const WOOD_DARK = 0x5e3c28;
const WOOD_MID = 0x7d5236;
const WOOD_LIGHT = 0x9a6c44;
const DECK_A = 0xc2a071;
const DECK_B = 0xab8a5f;

const SAIL_BRIGHT = 0xfaf7ee; // billowed columns catching the light
const SAIL_DIM = 0xeae4d2; // columns falling back toward the yard
const ROPE = 0x2c2218;

const GLASS_SEA = 0xbfe3e8;
const IRON = 0x6f7680;
const LANTERN = 0xffd9a0;
const PENNANT = 0xc4524a;

// ── geometry ────────────────────────────────────────────────────────────────

const SEA_Y = 8; // ocean is one slab layer; surface sits at y=8.5
const CX = 52; // hull centreline, nudged +X toward the camera
const MAST_Z = 40;
const STERN_Z = 63;

/** Hull bands stern→bow. `step` rows carry the descending bow ramp run. */
interface HullBand {
  readonly z0: number;
  readonly z1: number;
  readonly half: number; // half-beam
  readonly top: number; // deck cube layer (ramp layer on step rows)
  readonly step?: boolean;
}

const BANDS: readonly HullBand[] = [
  { z0: 23, z1: 24, half: 1, top: 10, step: true },
  { z0: 25, z1: 27, half: 2, top: 11, step: true },
  { z0: 28, z1: 31, half: 3, top: 12, step: true },
  { z0: 32, z1: 35, half: 4, top: 12 },
  { z0: 36, z1: 59, half: 5, top: 12 },
  { z0: 60, z1: 63, half: 4, top: 12 },
];

const Matte = MaterialClass.Matte;
const Glass = MaterialClass.Glass;
const Emissive = MaterialClass.Emissive;

/** Thin 1-voxel rope line: integer DDA along the dominant axis. */
const line3 = (
  ctx: SceneCtx,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void => {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ctx.set(
      Math.round(x0 + (x1 - x0) * t),
      Math.round(y0 + (y1 - y0) * t),
      Math.round(z0 + (z1 - z0) * t),
      Matte,
      ROPE,
    );
  }
};

// ── sea ─────────────────────────────────────────────────────────────────────

/** Two close blues in wide diagonal bands — calm water, no per-cell noise. */
const buildSea = (ctx: SceneCtx): void => {
  for (let z = 0; z < 96; z++) {
    for (let x = 0; x < 96; x++) {
      const lit = ((x + z * 2) & 15) < 5;
      ctx.set(x, SEA_Y, z, CLS_WATER, lit ? WATER_LITE : WATER_DEEP, SHAPE_SLAB_BOTTOM);
    }
  }
};

const foam = (ctx: SceneCtx, x: number, z: number): void =>
  ctx.set(x, SEA_Y, z, CLS_WATER, FOAM, SHAPE_SLAB_BOTTOM);

/** Sparse foam band hugging the hull, plus two short wake trails astern. */
const buildFoamAndWake = (ctx: SceneCtx): void => {
  // flecks along both sides of every hull row, with deterministic gaps
  for (const band of BANDS) {
    for (let z = band.z0; z <= band.z1; z++) {
      if (((z * 5) & 7) < 6) {
        foam(ctx, CX - band.half - 1, z);
        foam(ctx, CX + band.half + 1, z);
      }
    }
  }
  // around the stem and across the transom
  foam(ctx, CX - 1, 21);
  foam(ctx, CX + 1, 21);
  foam(ctx, CX, 20);
  for (let x = CX - 3; x <= CX + 3; x++) {
    if (((x * 5) & 7) < 6) foam(ctx, x, STERN_Z + 1);
  }
  // two wake trails angling outward off the stern quarters
  for (let i = 0; i < 8; i++) {
    foam(ctx, CX - 3 - (i >> 1), STERN_Z + 2 + i);
    foam(ctx, CX + 3 + (i >> 1), STERN_Z + 2 + i);
  }
};

// ── hull ────────────────────────────────────────────────────────────────────

/** Freeboard tones: keel band, dark planking, mid strake, light wale at deck. */
const hullColor = (x: number, y: number, half: number, solidTop: number, deck: boolean): number => {
  if (y === SEA_Y) return KEEL;
  if (y < solidTop - 1) return WOOD_DARK;
  if (y === solidTop - 1) return WOOD_MID;
  if (!deck || Math.abs(x - CX) === half) return WOOD_LIGHT;
  return (x - CX) & 1 ? DECK_B : DECK_A; // lengthwise plank stripes
};

const buildHull = (ctx: SceneCtx): void => {
  for (const band of BANDS) {
    for (let z = band.z0; z <= band.z1; z++) {
      const step = band.step === true && z === band.z0;
      const solidTop = step ? band.top - 1 : band.top;
      for (let x = CX - band.half; x <= CX + band.half; x++) {
        for (let y = SEA_Y; y <= solidTop; y++) {
          ctx.set(x, y, z, Matte, hullColor(x, y, band.half, solidTop, !step));
        }
      }
      if (step) {
        // complete bow descent: ramp run across the full beam, corner-capped
        ctx.set(CX - band.half, band.top, z, Matte, WOOD_LIGHT, SHAPE_CORNER_PXPZ);
        ctx.set(CX + band.half, band.top, z, Matte, WOOD_LIGHT, SHAPE_CORNER_NXPZ);
        for (let x = CX - band.half + 1; x <= CX + band.half - 1; x++) {
          ctx.set(x, band.top, z, Matte, WOOD_LIGHT, SHAPE_RAMP_PZ);
        }
      }
    }
  }

  // proud stem: forefoot row, then a post rising above the bow deck
  ctx.box(CX, SEA_Y, 22, CX, 9, 22, Matte, WOOD_DARK);
  ctx.set(CX, SEA_Y, 21, Matte, KEEL);
  ctx.box(CX, 9, 21, CX, 10, 21, Matte, WOOD_DARK);
  ctx.box(CX, 11, 21, CX, 12, 21, Matte, WOOD_MID);
  ctx.set(CX, 13, 21, Matte, WOOD_LIGHT);

  // transom: three glass stern windows set into the light wale
  ctx.set(CX - 2, 12, STERN_Z, Glass, GLASS_SEA);
  ctx.set(CX, 12, STERN_Z, Glass, GLASS_SEA);
  ctx.set(CX + 2, 12, STERN_Z, Glass, GLASS_SEA);
};

/** Midship bulwark: continuous panel runs with posts, both sides. */
const buildBulwark = (ctx: SceneCtx): void => {
  for (let z = 36; z <= 53; z++) {
    ctx.set(CX - 5, 13, z, Matte, WOOD_MID, SHAPE_VSLAB_NX);
    ctx.set(CX + 5, 13, z, Matte, WOOD_MID, SHAPE_VSLAB_PX);
  }
  for (const z of [36, 42, 48, 53]) {
    ctx.set(CX - 5, 13, z, Matte, WOOD_DARK);
    ctx.set(CX + 5, 13, z, Matte, WOOD_DARK);
  }
};

// ── quarterdeck ─────────────────────────────────────────────────────────────

const buildQuarterdeck = (ctx: SceneCtx): void => {
  // raised mass over the stern rows, deck two above the waist
  for (let z = 54; z <= STERN_Z; z++) {
    const half = z <= 59 ? 5 : 4;
    for (let x = CX - half; x <= CX + half; x++) {
      ctx.set(x, 13, z, Matte, WOOD_MID);
      const rim = Math.abs(x - CX) === half;
      ctx.set(x, 14, z, Matte, rim ? WOOD_LIGHT : (x - CX) & 1 ? DECK_B : DECK_A);
    }
  }

  // companionway: two stacked 3-wide ramp runs climbing from the waist
  for (let x = CX - 1; x <= CX + 1; x++) {
    ctx.set(x, 13, 52, Matte, DECK_B, SHAPE_RAMP_PZ);
    ctx.set(x, 13, 53, Matte, DECK_B);
    ctx.set(x, 14, 53, Matte, DECK_B, SHAPE_RAMP_PZ);
  }

  // rail ring at y=15: front run (gap at the stair), side runs, stern run
  for (let x = CX - 5; x <= CX + 5; x++) {
    if (Math.abs(x - CX) > 1) ctx.set(x, 15, 54, Matte, WOOD_MID, SHAPE_VSLAB_NZ);
  }
  for (let z = 55; z <= 59; z++) {
    ctx.set(CX - 5, 15, z, Matte, WOOD_MID, SHAPE_VSLAB_NX);
    ctx.set(CX + 5, 15, z, Matte, WOOD_MID, SHAPE_VSLAB_PX);
  }
  for (let z = 60; z <= 62; z++) {
    ctx.set(CX - 4, 15, z, Matte, WOOD_MID, SHAPE_VSLAB_NX);
    ctx.set(CX + 4, 15, z, Matte, WOOD_MID, SHAPE_VSLAB_PX);
  }
  for (let x = CX - 4; x <= CX + 4; x++) {
    ctx.set(x, 15, STERN_Z, Matte, WOOD_MID, SHAPE_VSLAB_PZ);
  }
  // posts at the ring corners, the stair gap, and the beam step
  for (const [x, z] of [
    [CX - 5, 54],
    [CX + 5, 54],
    [CX - 2, 54],
    [CX + 2, 54],
    [CX - 5, 59],
    [CX + 5, 59],
    [CX - 4, 60],
    [CX + 4, 60],
    [CX - 4, STERN_Z],
    [CX + 4, STERN_Z],
  ] as const) {
    ctx.set(x, 15, z, Matte, WOOD_DARK);
  }

  // stern lantern: iron post on the taffrail, warm glow, iron cap
  ctx.set(CX, 15, STERN_Z, CLS_METAL, IRON);
  ctx.set(CX, 16, STERN_Z, Emissive, LANTERN);
  ctx.set(CX, 17, STERN_Z, CLS_METAL, IRON, SHAPE_SLAB_BOTTOM);
};

// ── rig: mast, yards, square sails ──────────────────────────────────────────

interface SailSpec {
  readonly yBot: number;
  readonly yTop: number;
  readonly halfW: number;
  readonly yardY: number;
}

const SAILS: readonly SailSpec[] = [
  { yBot: 14, yTop: 21, halfW: 5, yardY: 22 }, // course
  { yBot: 24, yTop: 29, halfW: 4, yardY: 30 }, // topsail
  { yBot: 32, yTop: 36, halfW: 3, yardY: 37 }, // topgallant
];

/**
 * Billow: solid 1-voxel-thick canvas, each column's z plane stepping forward
 * toward the centre. `r` is the distance in from the sail edge. Full cubes so
 * the staggered column flanks catch the hero camera's dominant -X view.
 */
const sailPlane = (r: number): number => (r === 0 ? 39 : r <= 2 ? 38 : 37);

const buildRig = (ctx: SceneCtx): void => {
  // mast from deck to masthead
  ctx.box(CX, 13, MAST_Z, CX, 44, MAST_Z, Matte, WOOD_DARK);

  for (const sail of SAILS) {
    // yard: dark spar braced against the mast face
    ctx.box(CX - sail.halfW, sail.yardY, 39, CX + sail.halfW, sail.yardY, 39, Matte, KEEL);
    // canvas: each column one unbroken vertical cube run on its own plane
    for (let dx = -sail.halfW; dx <= sail.halfW; dx++) {
      const z = sailPlane(sail.halfW - Math.abs(dx));
      const rgb = z === 37 ? SAIL_BRIGHT : SAIL_DIM;
      for (let y = sail.yBot; y <= sail.yTop; y++) {
        ctx.set(CX + dx, y, z, Matte, rgb);
      }
    }
  }

  // pennant streaming aft off the masthead
  ctx.set(CX, 44, 41, Matte, PENNANT, SHAPE_VSLAB_PX);
  ctx.set(CX, 44, 42, Matte, PENNANT, SHAPE_VSLAB_PX);
  ctx.set(CX, 43, 41, Matte, PENNANT, SHAPE_VSLAB_PX);
};

// ── headgear: bowsprit + jib ────────────────────────────────────────────────

/** Jib columns (z, yBot, yTop): triangle between forestay and bowsprit. */
const JIB: ReadonlyArray<readonly [number, number, number]> = [
  [18, 15, 16],
  [19, 15, 17],
  [20, 15, 19],
  [21, 16, 20],
  [22, 16, 21],
  [23, 16, 22],
  [24, 16, 23],
  [25, 17, 24],
  [26, 17, 25],
];

const buildHeadgear = (ctx: SceneCtx): void => {
  // bowsprit climbing off the stem head
  ctx.set(CX, 13, 20, Matte, WOOD_DARK);
  ctx.set(CX, 13, 19, Matte, WOOD_DARK);
  ctx.set(CX, 14, 18, Matte, WOOD_DARK);
  ctx.set(CX, 14, 17, Matte, WOOD_DARK);
  ctx.set(CX, 15, 16, Matte, WOOD_DARK);

  // jib: unbroken vertical panel runs, flush to the camera-side wall
  for (const [z, yBot, yTop] of JIB) {
    for (let y = yBot; y <= yTop; y++) {
      ctx.set(CX, y, z, Matte, SAIL_DIM, SHAPE_VSLAB_PX);
    }
  }
};

// ── deck furniture ──────────────────────────────────────────────────────────

const buildDetails = (ctx: SceneCtx): void => {
  // main hatch: dark grating patch set into the waist planking
  ctx.box(CX - 1, 12, 45, CX + 1, 12, 47, Matte, WOOD_DARK);
  // capstan just forward of the companionway
  ctx.set(CX, 13, 49, Matte, KEEL);
  ctx.set(CX, 14, 49, Matte, WOOD_MID, SHAPE_SLAB_BOTTOM);
};

// ── scene ───────────────────────────────────────────────────────────────────

export const scene: SceneSpec = {
  id: "sail-ship",
  name: "Sail Ship",
  blurb: "square-rigged sloop riding calm seas",
  cx: 3,
  cy: 2,
  cz: 3,
  build(ctx: SceneCtx): void {
    buildSea(ctx);
    buildFoamAndWake(ctx);
    buildHull(ctx);
    buildBulwark(ctx);
    buildQuarterdeck(ctx);
    buildRig(ctx);
    buildHeadgear(ctx);

    // standing rigging, kept sparse so the canvas dominates: forestay over
    // the jib luff plus a backstay pair to the stern rail
    line3(ctx, CX, 43, MAST_Z, CX, 15, 16); // forestay
    line3(ctx, CX, 43, MAST_Z, CX - 4, 16, 62); // port backstay
    line3(ctx, CX, 43, MAST_Z, CX + 4, 16, 62); // starboard backstay

    buildDetails(ctx);
  },
};
