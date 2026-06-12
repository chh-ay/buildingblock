/**
 * Desert Oasis — three broad dune swells, a sunken kidney pool ringed in
 * stone, leaning palms, and a small walled adobe yard.
 *
 * Composition (hero camera sits at +X/−Z looking toward −X/+Z, ~33° up):
 * - foreground (+X/−Z) stays low, flat, calm sand;
 * - the pool sits slightly screen-left of centre, the village screen-right;
 * - the tall dune ridge and the tallest palms close the silhouette behind.
 *
 * Terrain discipline: a low-frequency heightfield (terraces 0–6) is fitted
 * with ramp/corner/inner wedges only where a contour steps by exactly one,
 * then a fixpoint pass deletes every wedge that lacks a same-slope neighbour
 * along its level axis and finally asserts that zero isolated wedges remain.
 * Every bevel is therefore a complete run or ring; the only freestanding
 * wedges in the scene are the deliberate palm-frond tips high in the crowns.
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
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
} from "../scene";

// ── Palette ─────────────────────────────────────────────────────────────────

const SAND_LOW = 0xc89a64; // valley floors and the base plate
const SAND_MID = 0xdebb82; // the oasis terrace band
const SAND_CREST = 0xf0d8a6; // sunlit dune crests
const STONE = 0xa59c8a;
const STONE_DARK = 0x7f7668;
const WATER_DEEP = 0x2477b8;
const WATER_LIT = 0x45b3dd;
const TRUNK = 0x8a6442;
const TRUNK_DARK = 0x68472e;
const FROND_DARK = 0x3c7a36;
const FROND_LIGHT = 0x60a44c;
const REED = 0x7da23e;
const DATE = 0xc07028;
const ADOBE = 0xe2cba2;
const ADOBE_LIGHT = 0xf0e2c2;
const ADOBE_DARK = 0xc2a274;
const DOME_WHITE = 0xf8efdc;
const CLAY = 0xa8512e;
const METAL = 0x8d979e;
const GLOW = 0xffc070;

// ── Layout ──────────────────────────────────────────────────────────────────

const PLATE = 96;
const PLATEAU = 2; // terrace height the pool, palms, and village all share
const POOL_CX = 52;
const POOL_CZ = 53;

const idx = (x: number, z: number): number => x * PLATE + z;
const clampi = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Kidney pool: union of two overlapping discs, centre-left of the plate. */
const inPool = (x: number, z: number): boolean =>
  (x - 57) ** 2 + (z - 49) ** 2 <= 72.25 || (x - 47) ** 2 + (z - 57) ** 2 <= 49;

/** One continuous stone ring: every dry cell 8-adjacent to water. */
const isRim = (x: number, z: number): boolean => {
  if (inPool(x, z)) return false;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if ((dx !== 0 || dz !== 0) && inPool(x + dx, z + dz)) return true;
    }
  }
  return false;
};

// ── Heightfield: three broad ridges flattened onto the oasis terrace ────────

const gauss = (t: number): number => Math.exp(-t * t);

const smooth01 = (t: number): number => {
  const c = clampi(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Distance from (px,pz) to the segment (ax,az)→(bx,bz). */
const segDist = (
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number => {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clampi(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};

/** Distance outside an axis-aligned rectangle (0 inside). */
const rectDist = (x: number, z: number, x0: number, z0: number, x1: number, z1: number): number =>
  Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));

/** Two or three broad dune ridges only — no high-frequency noise anywhere. */
const duneHeight = (x: number, z: number): number =>
  Math.max(
    6.4 * gauss(segDist(x, z, 2, 60, 64, 95) / 13), // main crest across the back
    3.4 * gauss(segDist(x, z, 92, 46, 64, 95) / 11), // screen-left shoulder
    2.3 * gauss(segDist(x, z, 4, 28, 18, 8) / 9), // gentle swell screen-right
  );

/** 1 where the pool, village pad, and lantern trail flatten the dunes. */
const terraceMask = (x: number, z: number): number =>
  Math.max(
    1 - smooth01((Math.hypot(x - POOL_CX, z - POOL_CZ) - 15) / 8),
    1 - smooth01(rectDist(x, z, 14, 10, 44, 38) / 8),
    1 - smooth01((segDist(x, z, 30, 35, 43, 51) - 4) / 7),
  );

// ── Wedge grammar ───────────────────────────────────────────────────────────

interface Slope {
  readonly sx: number;
  readonly sz: number;
  readonly inner: boolean;
}

/** Which way each wedge's high side points; inner corners check the far side. */
const WEDGE_SLOPES: Readonly<Record<number, Slope | undefined>> = {
  [SHAPE_RAMP_PX]: { sx: 1, sz: 0, inner: false },
  [SHAPE_RAMP_NX]: { sx: -1, sz: 0, inner: false },
  [SHAPE_RAMP_PZ]: { sx: 0, sz: 1, inner: false },
  [SHAPE_RAMP_NZ]: { sx: 0, sz: -1, inner: false },
  [SHAPE_CORNER_PXPZ]: { sx: 1, sz: 1, inner: false },
  [SHAPE_CORNER_NXPZ]: { sx: -1, sz: 1, inner: false },
  [SHAPE_CORNER_NXNZ]: { sx: -1, sz: -1, inner: false },
  [SHAPE_CORNER_PXNZ]: { sx: 1, sz: -1, inner: false },
  [SHAPE_INNER_PXPZ]: { sx: 1, sz: 1, inner: true },
  [SHAPE_INNER_NXPZ]: { sx: -1, sz: 1, inner: true },
  [SHAPE_INNER_NXNZ]: { sx: -1, sz: -1, inner: true },
  [SHAPE_INNER_PXNZ]: { sx: 1, sz: -1, inner: true },
};

const rampToward = (sx: number, sz: number): number => {
  if (sx === 1) return SHAPE_RAMP_PX;
  if (sx === -1) return SHAPE_RAMP_NX;
  return sz === 1 ? SHAPE_RAMP_PZ : SHAPE_RAMP_NZ;
};

const cornerToward = (sx: number, sz: number): number => {
  if (sx === 1) return sz === 1 ? SHAPE_CORNER_PXPZ : SHAPE_CORNER_PXNZ;
  return sz === 1 ? SHAPE_CORNER_NXPZ : SHAPE_CORNER_NXNZ;
};

const innerToward = (sx: number, sz: number): number => {
  if (sx === 1) return sz === 1 ? SHAPE_INNER_PXPZ : SHAPE_INNER_PXNZ;
  return sz === 1 ? SHAPE_INNER_NXPZ : SHAPE_INNER_NXNZ;
};

const DIAGS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// ── Terrain synthesis + continuity validation ───────────────────────────────

interface Terrain {
  /** Top cube y per column (terrace level, 0–6). */
  readonly height: Uint8Array;
  /** Surface wedge per column (0 = square ledge), sitting at height+1. */
  readonly wedge: Uint8Array;
}

const computeTerrain = (): Terrain => {
  const height = new Uint8Array(PLATE * PLATE);
  for (let x = 0; x < PLATE; x++) {
    for (let z = 0; z < PLATE; z++) {
      if (inPool(x, z) || isRim(x, z)) {
        height[idx(x, z)] = PLATEAU;
        continue;
      }
      const m = terraceMask(x, z);
      const h = duneHeight(x, z) * (1 - m) + PLATEAU * m;
      height[idx(x, z)] = clampi(Math.round(h), 0, 6);
    }
  }

  const at = (x: number, z: number): number =>
    height[idx(clampi(x, 0, PLATE - 1), clampi(z, 0, PLATE - 1))];

  // Fit wedges where a contour steps by exactly one cell.
  const wedge = new Uint8Array(PLATE * PLATE);
  for (let x = 0; x < PLATE; x++) {
    for (let z = 0; z < PLATE; z++) {
      if (inPool(x, z) || isRim(x, z)) continue;
      const h = at(x, z);
      const dpx = at(x + 1, z) - h;
      const dnx = at(x - 1, z) - h;
      const dpz = at(x, z + 1) - h;
      const dnz = at(x, z - 1) - h;
      if (Math.max(dpx, dnx, dpz, dnz) > 1) continue; // 2+ steps stay crisp cliffs
      const upsX = (dpx === 1 ? 1 : 0) + (dnx === 1 ? 1 : 0);
      const upsZ = (dpz === 1 ? 1 : 0) + (dnz === 1 ? 1 : 0);
      const i = idx(x, z);
      if (upsX + upsZ === 1) {
        // one side climbs: a ramp in the middle of a contour run
        const sx = dpx === 1 ? 1 : dnx === 1 ? -1 : 0;
        const sz = dpz === 1 ? 1 : dnz === 1 ? -1 : 0;
        wedge[i] = rampToward(sx, sz);
      } else if (upsX === 1 && upsZ === 1) {
        // two adjacent sides climb: the concave elbow of an L-shaped terrace
        const sx = dpx === 1 ? 1 : -1;
        const sz = dpz === 1 ? 1 : -1;
        if (at(x + sx, z + sz) === h + 1) wedge[i] = innerToward(sx, sz);
      } else if (upsX + upsZ === 0) {
        // flat sides; a single climbing diagonal is a convex contour turn
        let hits = 0;
        let csx = 0;
        let csz = 0;
        for (const [sx, sz] of DIAGS) {
          const flanksFlat = (sx === 1 ? dpx : dnx) === 0 && (sz === 1 ? dpz : dnz) === 0;
          if (at(x + sx, z + sz) - h === 1 && flanksFlat) {
            hits++;
            csx = sx;
            csz = sz;
          }
        }
        if (hits === 1) wedge[i] = cornerToward(csx, csz);
      }
    }
  }

  // A wedge survives only while a same-slope neighbour continues its run along
  // the level axis (corners chain into the two ramp runs they join). Removing
  // a wedge can orphan its neighbour, so iterate to a fixpoint.
  const matchX = (x: number, z: number, y: number, sx: number): boolean => {
    if (x < 0 || z < 0 || x >= PLATE || z >= PLATE) return false;
    const s = WEDGE_SLOPES[wedge[idx(x, z)]];
    return s !== undefined && s.sx === sx && at(x, z) + 1 === y;
  };
  const matchZ = (x: number, z: number, y: number, sz: number): boolean => {
    if (x < 0 || z < 0 || x >= PLATE || z >= PLATE) return false;
    const s = WEDGE_SLOPES[wedge[idx(x, z)]];
    return s !== undefined && s.sz === sz && at(x, z) + 1 === y;
  };
  const continues = (x: number, z: number): boolean => {
    const s = WEDGE_SLOPES[wedge[idx(x, z)]];
    if (s === undefined) return true;
    const y = at(x, z) + 1;
    if (s.sz === 0) return matchX(x, z - 1, y, s.sx) || matchX(x, z + 1, y, s.sx);
    if (s.sx === 0) return matchZ(x - 1, z, y, s.sz) || matchZ(x + 1, z, y, s.sz);
    const d = s.inner ? -1 : 1;
    return matchX(x, z + d * s.sz, y, s.sx) || matchZ(x + d * s.sx, z, y, s.sz);
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (let x = 0; x < PLATE; x++) {
      for (let z = 0; z < PLATE; z++) {
        if (wedge[idx(x, z)] !== 0 && !continues(x, z)) {
          wedge[idx(x, z)] = 0;
          changed = true;
        }
      }
    }
  }

  let lone = 0;
  for (let x = 0; x < PLATE; x++) {
    for (let z = 0; z < PLATE; z++) {
      if (wedge[idx(x, z)] !== 0 && !continues(x, z)) lone++;
    }
  }
  if (lone > 0) throw new Error(`oasis terrain: ${lone} isolated wedges survived validation`);

  return { height, wedge };
};

// ── Terrain paint ───────────────────────────────────────────────────────────

/** Three warm sand tones banded by elevation — no per-voxel speckle. */
const band = (y: number): number => (y <= 1 ? SAND_LOW : y <= 3 ? SAND_MID : SAND_CREST);

const matte = (ctx: SceneCtx, x: number, y: number, z: number, rgb: number, shape = SHAPE_CUBE) =>
  ctx.set(x, y, z, MaterialClass.Matte, rgb, shape);

const paintTerrain = (ctx: SceneCtx, terrain: Terrain): void => {
  const at = (x: number, z: number): number =>
    terrain.height[idx(clampi(x, 0, PLATE - 1), clampi(z, 0, PLATE - 1))];

  for (let x = 0; x < PLATE; x++) {
    for (let z = 0; z < PLATE; z++) {
      matte(ctx, x, 0, z, SAND_LOW); // base plate seals the underside

      if (inPool(x, z)) {
        // water surface one full level below the rim cap
        const edge = isRim(x - 1, z) || isRim(x + 1, z) || isRim(x, z - 1) || isRim(x, z + 1);
        ctx.set(x, 1, z, CLS_WATER, edge ? WATER_LIT : WATER_DEEP);
        continue;
      }
      if (isRim(x, z)) {
        // solid stone edging below the waterline, capped by a slab lip
        matte(ctx, x, 1, z, STONE_DARK);
        matte(ctx, x, 2, z, STONE_DARK);
        matte(ctx, x, 3, z, STONE, SHAPE_SLAB_BOTTOM);
        continue;
      }

      const h = at(x, z);
      if (h > 0) {
        const m = Math.min(at(x - 1, z), at(x + 1, z), at(x, z - 1), at(x, z + 1), h);
        for (let y = Math.max(1, Math.min(m + 1, h)); y <= h; y++) {
          matte(ctx, x, y, z, band(y));
        }
      }
      const w = terrain.wedge[idx(x, z)];
      if (w !== 0) matte(ctx, x, h + 1, z, band(h + 1), w);
    }
  }
};

// ── Palms and reeds ─────────────────────────────────────────────────────────

/**
 * Symmetric frond rosette: four axis arms (rib cube + drooping ramp tip rising
 * back toward the trunk) and four diagonal arms ending in corner tips — the
 * sanctioned single-wedge accent, in matched rings of four.
 */
const crown = (ctx: SceneCtx, x: number, y: number, z: number): void => {
  matte(ctx, x, y, z, FROND_DARK);
  matte(ctx, x, y + 1, z, FROND_LIGHT);

  const axisArms: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, SHAPE_RAMP_NX],
    [-1, 0, SHAPE_RAMP_PX],
    [0, 1, SHAPE_RAMP_NZ],
    [0, -1, SHAPE_RAMP_PZ],
  ];
  for (const [dx, dz, tip] of axisArms) {
    matte(ctx, x + dx, y, z + dz, FROND_DARK);
    matte(ctx, x + 2 * dx, y, z + 2 * dz, FROND_LIGHT, tip);
  }

  const diagArms: ReadonlyArray<readonly [number, number, number]> = [
    [1, 1, SHAPE_CORNER_NXNZ],
    [-1, 1, SHAPE_CORNER_PXNZ],
    [-1, -1, SHAPE_CORNER_PXPZ],
    [1, -1, SHAPE_CORNER_NXPZ],
  ];
  for (const [dx, dz, tip] of diagArms) {
    matte(ctx, x + dx, y, z + dz, FROND_LIGHT);
    matte(ctx, x + 2 * dx, y, z + 2 * dz, FROND_DARK, tip);
  }

  // date clusters hanging beside the trunk top
  matte(ctx, x + 1, y - 1, z, DATE);
  matte(ctx, x, y - 1, z + 1, DATE);
};

/** Curved trunk: two single-cube lean steps partway up, then the rosette. */
const palm = (
  ctx: SceneCtx,
  x: number,
  z: number,
  height: number,
  lx: number,
  lz: number,
): void => {
  let tx = x;
  let tz = z;
  for (let s = 0; s < height; s++) {
    if (s === height >> 1 || s === height - 2) {
      tx += lx;
      tz += lz;
    }
    matte(ctx, tx, 3 + s, tz, s % 3 === 2 ? TRUNK_DARK : TRUNK);
  }
  crown(ctx, tx, 3 + height, tz);
};

/** A tuft of thin reed columns hugging the shore — clustered, never lone. */
const reeds = (ctx: SceneCtx, cx: number, cz: number): void => {
  const tufts: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 3],
    [1, 0, 2],
    [0, 1, 2],
    [-1, 1, 3],
    [1, -1, 2],
  ];
  tufts.forEach(([dx, dz, h], i) => {
    const x = cx + dx;
    const z = cz + dz;
    if (inPool(x, z) || isRim(x, z)) return;
    for (let y = 3; y < 3 + h; y++) {
      matte(ctx, x, y, z, i % 2 === 0 ? REED : FROND_LIGHT);
    }
  });
};

const buildPoolside = (ctx: SceneCtx): void => {
  // taller palms behind the water (high Z), shorter ones up front
  palm(ctx, 52, 66, 9, 0, -1);
  palm(ctx, 40, 62, 8, 1, -1);
  palm(ctx, 64, 58, 7, -1, -1);
  palm(ctx, 44, 45, 6, 1, 1);
  palm(ctx, 67, 44, 5, -1, 1);

  reeds(ctx, 67, 52);
  reeds(ctx, 49, 66);
  reeds(ctx, 37, 55);
};

// ── Adobe village ───────────────────────────────────────────────────────────

/** Complete hip ring: four ramp runs and four corner wedges, no gaps. */
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
    matte(ctx, x, y, z0, rgb, SHAPE_RAMP_PZ);
    matte(ctx, x, y, z1, rgb, SHAPE_RAMP_NZ);
  }
  for (let z = z0 + 1; z < z1; z++) {
    matte(ctx, x0, y, z, rgb, SHAPE_RAMP_PX);
    matte(ctx, x1, y, z, rgb, SHAPE_RAMP_NX);
  }
  matte(ctx, x0, y, z0, rgb, SHAPE_CORNER_PXPZ);
  matte(ctx, x1, y, z0, rgb, SHAPE_CORNER_NXPZ);
  matte(ctx, x0, y, z1, rgb, SHAPE_CORNER_PXNZ);
  matte(ctx, x1, y, z1, rgb, SHAPE_CORNER_NXNZ);
};

/** Hollow adobe shell: dark base course, 4-high walls, roof deck, slab parapet. */
const adobeHouse = (
  ctx: SceneCtx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  wall: number,
  parapet: number,
): void => {
  const m = MaterialClass.Matte;
  ctx.box(x0, 3, z0, x1, 6, z0, m, wall);
  ctx.box(x0, 3, z1, x1, 6, z1, m, wall);
  ctx.box(x0, 3, z0, x0, 6, z1, m, wall);
  ctx.box(x1, 3, z0, x1, 6, z1, m, wall);
  ctx.box(x0, 3, z0, x1, 3, z0, m, ADOBE_DARK);
  ctx.box(x0, 3, z1, x1, 3, z1, m, ADOBE_DARK);
  ctx.box(x0, 3, z0, x0, 3, z1, m, ADOBE_DARK);
  ctx.box(x1, 3, z0, x1, 3, z1, m, ADOBE_DARK);
  ctx.box(x0, 7, z0, x1, 7, z1, m, ADOBE_DARK); // roof deck
  ctx.box(x0, 8, z0, x1, 8, z0, m, parapet, SHAPE_SLAB_BOTTOM);
  ctx.box(x0, 8, z1, x1, 8, z1, m, parapet, SHAPE_SLAB_BOTTOM);
  ctx.box(x0, 8, z0, x0, 8, z1, m, parapet, SHAPE_SLAB_BOTTOM);
  ctx.box(x1, 8, z0, x1, 8, z1, m, parapet, SHAPE_SLAB_BOTTOM);
};

/** Courtyard wall run: 3-high adobe with a continuous slab coping. */
const wallRun = (ctx: SceneCtx, x0: number, z0: number, x1: number, z1: number): void => {
  ctx.box(x0, 3, z0, x1, 5, z1, MaterialClass.Matte, ADOBE_DARK);
  ctx.box(x0, 6, z0, x1, 6, z1, MaterialClass.Matte, ADOBE, SHAPE_SLAB_BOTTOM);
};

const buildVillage = (ctx: SceneCtx): void => {
  // courtyard enclosure
  wallRun(ctx, 16, 12, 40, 12);
  wallRun(ctx, 16, 34, 40, 34);
  wallRun(ctx, 16, 12, 16, 34);
  wallRun(ctx, 40, 12, 40, 34);

  // arched gate facing the pool: raised section, stepped arch, hung lantern
  ctx.box(27, 3, 34, 33, 6, 34, MaterialClass.Matte, ADOBE_DARK);
  ctx.box(27, 7, 34, 33, 7, 34, MaterialClass.Matte, ADOBE, SHAPE_SLAB_BOTTOM);
  for (let x = 29; x <= 31; x++) {
    for (let y = 3; y <= 5; y++) ctx.clear(x, y, 34);
  }
  matte(ctx, 29, 5, 34, ADOBE_DARK, SHAPE_SLAB_TOP);
  matte(ctx, 31, 5, 34, ADOBE_DARK, SHAPE_SLAB_TOP);
  ctx.set(30, 5, 34, MaterialClass.Emissive, GLOW);

  // house A: long flat roof, glowing windows, clustered panel awnings
  adobeHouse(ctx, 18, 14, 28, 21, ADOBE, ADOBE_LIGHT);
  ctx.clear(23, 3, 21);
  ctx.clear(23, 4, 21); // courtyard door
  ctx.box(22, 3, 21, 22, 4, 21, MaterialClass.Matte, CLAY);
  ctx.box(24, 3, 21, 24, 4, 21, MaterialClass.Matte, CLAY);
  matte(ctx, 23, 5, 21, CLAY);
  ctx.box(22, 5, 22, 24, 5, 22, MaterialClass.Matte, CLAY, SHAPE_VSLAB_NZ); // door awning
  ctx.set(21, 5, 14, MaterialClass.Emissive, GLOW); // lamplit windows, camera side
  ctx.set(25, 5, 14, MaterialClass.Emissive, GLOW);
  matte(ctx, 21, 6, 14, CLAY);
  matte(ctx, 25, 6, 14, CLAY);
  ctx.box(20, 6, 13, 22, 6, 13, MaterialClass.Matte, CLAY, SHAPE_VSLAB_PZ); // window awnings
  ctx.box(24, 6, 13, 26, 6, 13, MaterialClass.Matte, CLAY, SHAPE_VSLAB_PZ);

  // house B: pale shell topped by a complete corner-wedge dome
  adobeHouse(ctx, 30, 22, 38, 30, ADOBE_LIGHT, ADOBE);
  hipRing(ctx, 32, 24, 35, 27, 8, DOME_WHITE);
  ctx.box(33, 8, 25, 34, 8, 26, MaterialClass.Matte, DOME_WHITE);
  matte(ctx, 33, 9, 25, DOME_WHITE, SHAPE_CORNER_PXPZ);
  matte(ctx, 34, 9, 25, DOME_WHITE, SHAPE_CORNER_NXPZ);
  matte(ctx, 33, 9, 26, DOME_WHITE, SHAPE_CORNER_PXNZ);
  matte(ctx, 34, 9, 26, DOME_WHITE, SHAPE_CORNER_NXNZ);
  ctx.clear(30, 3, 26);
  ctx.clear(30, 4, 26); // courtyard door
  ctx.box(30, 3, 25, 30, 4, 25, MaterialClass.Matte, CLAY);
  ctx.box(30, 3, 27, 30, 4, 27, MaterialClass.Matte, CLAY);
  matte(ctx, 30, 5, 26, CLAY);
  ctx.box(29, 5, 25, 29, 5, 27, MaterialClass.Matte, CLAY, SHAPE_VSLAB_PX); // door awning
  ctx.set(34, 5, 22, MaterialClass.Emissive, GLOW); // camera-side window
  matte(ctx, 34, 6, 22, CLAY);

  // courtyard well: stone ring, recessed water, metal posts, hip canopy
  ctx.box(23, 3, 26, 25, 3, 28, MaterialClass.Matte, STONE_DARK);
  ctx.clear(24, 3, 27);
  ctx.set(24, 2, 27, CLS_WATER, WATER_LIT);
  for (const [px, pz] of [
    [23, 26],
    [25, 26],
    [23, 28],
    [25, 28],
  ] as const) {
    ctx.box(px, 4, pz, px, 5, pz, CLS_METAL, METAL);
  }
  hipRing(ctx, 23, 26, 25, 28, 6, CLAY);
  matte(ctx, 24, 6, 27, CLAY);
};

// ── Lantern trail, caravan camel ────────────────────────────────────────────

const lantern = (ctx: SceneCtx, x: number, z: number): void => {
  matte(ctx, x, 3, z, TRUNK_DARK);
  matte(ctx, x, 4, z, TRUNK_DARK);
  ctx.set(x, 5, z, MaterialClass.Emissive, GLOW);
};

/** Slab walk from the gate to the pool rim, lanterns staked along the side. */
const buildTrail = (ctx: SceneCtx): void => {
  let x = 30;
  let z = 35;
  let step = 0;
  while (x < 43 || z < 51) {
    if (z < 51 && (z - 35) * 13 <= (x - 30) * 16) z++;
    else x++;
    for (const [px, pz] of [
      [x, z],
      [x + 1, z],
      [x, z + 1],
      [x + 1, z + 1],
    ] as const) {
      if (!inPool(px, pz)) matte(ctx, px, 3, pz, STONE, SHAPE_SLAB_BOTTOM);
    }
    step++;
    if (step === 6 || step === 15 || step === 24) lantern(ctx, x + 2, z - 2);
  }
};

/** Kneeling camel resting beside the trail — pure cubes, side-on silhouette. */
const buildCamel = (ctx: SceneCtx): void => {
  const m = MaterialClass.Matte;
  ctx.box(44, 3, 40, 48, 3, 41, m, TRUNK_DARK); // folded legs
  ctx.box(44, 4, 40, 48, 4, 41, m, TRUNK); // body
  ctx.box(45, 5, 40, 46, 5, 41, m, TRUNK); // hump
  ctx.box(45, 6, 40, 46, 6, 41, m, CLAY, SHAPE_SLAB_BOTTOM); // saddle blanket
  matte(ctx, 48, 5, 40, TRUNK); // neck
  matte(ctx, 48, 6, 40, TRUNK);
  matte(ctx, 49, 6, 40, TRUNK_DARK); // head
  matte(ctx, 43, 4, 41, TRUNK_DARK); // tail
};

// ── Scene ───────────────────────────────────────────────────────────────────

const build = (ctx: SceneCtx): void => {
  paintTerrain(ctx, computeTerrain());
  buildPoolside(ctx);
  buildVillage(ctx);
  buildTrail(ctx);
  buildCamel(ctx);
};

export const scene: SceneSpec = {
  id: "oasis",
  name: "Desert Oasis",
  blurb: "palms and cool water in the dunes",
  cx: 3,
  cy: 2,
  cz: 3,
  build,
};
