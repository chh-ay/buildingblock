import type { SceneCtx, SceneSpec } from "../scene";
import {
  MaterialClass,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
} from "../scene";

const STONE = 0x8b8f96;
const STONE_DARK = 0x767b83;
const SLATE = 0x46566e;
const GRASS_A = 0x5a7747;
const GRASS_B = 0x4e6a3d;
const DIRT = 0x8a7350;
const WOOD = 0x8a5a3b;
const WOOD_DARK = 0x55402c;
const RED = 0x9c3938;
const GOLD = 0xc9a24b;
const CREAM = 0xe8e0cf;
const WATER = 0x3f6b85;
const WELL_WATER = 0x1b3340;
const IRON = 0x3a3f45;
const TORCH = 0xffb45e;

const hash = (x: number, z: number): number => {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
};

// rounded ground pad with a jittered organic edge
const onPad = (x: number, z: number): boolean => {
  const nx = (x - 48) / 35;
  const nz = (z - 48) / 35;
  const wobble = ((hash(x, z) % 100) / 100) * 0.1;
  return nx ** 4 + nz ** 4 <= 1 - wobble;
};

const stone = (x: number, y: number, z: number): number => ((x + y + z) & 1 ? STONE : STONE_DARK);

const build = (ctx: SceneCtx): void => {
  const { set, clear, box } = ctx;
  const M = MaterialClass;

  // grass pad, two greens dithered
  for (let z = 13; z <= 83; z++) {
    for (let x = 13; x <= 83; x++) {
      if (!onPad(x, z)) continue;
      set(x, 0, z, M.Matte, (x + z) & 1 ? GRASS_A : GRASS_B);
    }
  }

  // dirt approach road and courtyard path (gate sits at x=47..49, z=24..25)
  box(46, 0, 14, 50, 0, 23, M.Matte, DIRT);
  box(47, 0, 26, 49, 0, 41, M.Matte, DIRT);

  // shallow moat band crossing the approach, plank bridge over it
  for (let z = 16; z <= 19; z++) {
    for (let x = 34; x <= 62; x++) set(x, 0, z, M.Gloss, WATER, SHAPE_SLAB_BOTTOM);
  }
  box(46, 1, 14, 50, 1, 21, M.Matte, WOOD, SHAPE_SLAB_BOTTOM);
  for (const px of [46, 50]) {
    set(px, 1, 14, M.Matte, WOOD_DARK);
    set(px, 1, 21, M.Matte, WOOD_DARK);
  }

  // curtain wall: 2-thick band, merlons on the outer course, walkway slabs inside
  const w0 = 24;
  const w1 = 72;
  const inBand = (x: number, z: number): boolean => {
    const edgeX = x === w0 || x === w0 + 1 || x === w1 - 1 || x === w1;
    const edgeZ = z === w0 || z === w0 + 1 || z === w1 - 1 || z === w1;
    return (edgeX || edgeZ) && x >= w0 && x <= w1 && z >= w0 && z <= w1;
  };
  const isOuter = (x: number, z: number): boolean => x === w0 || x === w1 || z === w0 || z === w1;
  for (let z = w0; z <= w1; z++) {
    for (let x = w0; x <= w1; x++) {
      if (!inBand(x, z)) continue;
      for (let y = 1; y <= 6; y++) set(x, y, z, M.Matte, stone(x, y, z));
      if (isOuter(x, z)) {
        if ((x + z) % 2 === 0) set(x, 7, z, M.Matte, STONE_DARK); // merlon
      } else {
        set(x, 7, z, M.Matte, STONE, SHAPE_SLAB_BOTTOM); // rampart walkway
      }
    }
  }

  // gatehouse: carve the arch, hint a portcullis, flank with demi-towers
  for (const z of [24, 25]) {
    for (let x = 47; x <= 49; x++) {
      for (let y = 1; y <= 3; y++) clear(x, y, z);
    }
    clear(48, 4, z);
  }
  set(47, 3, 25, M.Matte, IRON);
  set(49, 3, 25, M.Matte, IRON);
  set(48, 4, 25, M.Matte, IRON);
  for (const cx of [44, 52]) {
    for (let dz = -2; dz <= 0; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > 5) continue;
        for (let y = 1; y <= 8; y++) set(cx + dx, y, 24 + dz, M.Matte, stone(cx + dx, y, 24 + dz));
        if (d2 >= 4 && (dx + dz) % 2 === 0) set(cx + dx, 9, 24 + dz, M.Matte, STONE_DARK);
      }
    }
  }

  // torch posts flanking the approach to the gate
  for (const tx of [44, 52]) {
    box(tx, 1, 21, tx, 3, 21, M.Matte, WOOD_DARK);
    set(tx, 4, 21, M.Emissive, TORCH);
  }

  // round corner towers with slate cone roofs
  const towers: Array<[number, number]> = [
    [24.5, 24.5],
    [71.5, 24.5],
    [24.5, 71.5],
    [71.5, 71.5],
  ];
  for (const [tx, tz] of towers) {
    for (let z = Math.floor(tz) - 4; z <= Math.ceil(tz) + 4; z++) {
      for (let x = Math.floor(tx) - 4; x <= Math.ceil(tx) + 4; x++) {
        const d2 = (x - tx) ** 2 + (z - tz) ** 2;
        if (d2 > 12.5) continue;
        for (let y = 1; y <= 13; y++) set(x, y, z, M.Matte, stone(x, y, z));
      }
    }
    // cone: shrinking discs, outward-facing ramps on each ring, slab tip
    for (let j = 0; j <= 2; j++) {
      const rmax = 3.3 - j * 1.15;
      const y = 14 + j;
      for (let z = Math.floor(tz) - 4; z <= Math.ceil(tz) + 4; z++) {
        for (let x = Math.floor(tx) - 4; x <= Math.ceil(tx) + 4; x++) {
          const dx = x - tx;
          const dz = z - tz;
          const d2 = dx * dx + dz * dz;
          if (d2 > rmax * rmax) continue;
          if (d2 > (rmax - 1) * (rmax - 1)) {
            const shape =
              Math.abs(dx) >= Math.abs(dz)
                ? dx > 0
                  ? SHAPE_RAMP_NX
                  : SHAPE_RAMP_PX
                : dz > 0
                  ? SHAPE_RAMP_NZ
                  : SHAPE_RAMP_PZ;
            set(x, y, z, M.Matte, SLATE, shape);
          } else {
            set(x, y, z, M.Matte, SLATE);
          }
        }
      }
    }
    for (const x of [Math.floor(tx), Math.ceil(tx)]) {
      for (const z of [Math.floor(tz), Math.ceil(tz)]) {
        set(x, 17, z, M.Matte, SLATE, SHAPE_SLAB_BOTTOM);
      }
    }
  }

  // heraldic banners hung on the wall faces
  const banner = (x: number, z: number, n: number): void =>
    box(x, 4, z, x, 6, z, M.Matte, n & 1 ? GOLD : RED);
  for (const [i, x] of [31, 37, 59, 65].entries()) banner(x, 23, i);
  for (const [i, z] of [36, 48, 60].entries()) {
    banner(23, z, i);
    banner(73, z, i + 1);
  }
  for (const [i, x] of [40, 56].entries()) banner(x, 73, i);

  // central keep: hollow shell, string-course ledge, gable roof ridge along x
  const k0 = 42;
  const k1 = 56;
  for (let y = 1; y <= 12; y++) {
    for (let z = k0; z <= k1; z++) {
      for (let x = k0; x <= k1; x++) {
        if (x !== k0 && x !== k1 && z !== k0 && z !== k1) continue;
        set(x, y, z, M.Matte, stone(x, y, z));
      }
    }
  }
  for (let z = k0 - 1; z <= k1 + 1; z++) {
    for (let x = k0 - 1; x <= k1 + 1; x++) {
      if (x !== k0 - 1 && x !== k1 + 1 && z !== k0 - 1 && z !== k1 + 1) continue;
      set(x, 8, z, M.Matte, STONE_DARK, SHAPE_SLAB_BOTTOM);
    }
  }
  for (let i = 0; i <= 6; i++) {
    const y = 13 + i;
    for (let x = k0; x <= k1; x++) {
      set(x, y, k0 + i, M.Matte, SLATE, SHAPE_RAMP_PZ);
      set(x, y, k1 - i, M.Matte, SLATE, SHAPE_RAMP_NZ);
    }
  }
  box(k0, 20, 49, k1, 20, 49, M.Matte, SLATE);
  for (let j = 0; j <= 6; j++) {
    const tone = j & 1 ? STONE : STONE_DARK;
    box(k0, 13 + j, k0 + 1 + j, k0, 13 + j, k1 - 1 - j, M.Matte, tone);
    box(k1, 13 + j, k0 + 1 + j, k1, 13 + j, k1 - 1 - j, M.Matte, tone);
  }
  // keep door and lit arrow slits
  box(48, 1, k0, 50, 3, k0, M.Matte, WOOD_DARK);
  set(49, 4, k0, M.Matte, WOOD_DARK);
  for (const sx of [45, 53]) box(sx, 9, k0, sx, 10, k0, M.Emissive, TORCH);
  for (const sz of [46, 52]) {
    box(k0, 9, sz, k0, 10, sz, M.Emissive, TORCH);
    box(k1, 9, sz, k1, 10, sz, M.Emissive, TORCH);
  }

  // courtyard well: stone ring, dark water, tiny gabled roof
  const wx = 34;
  const wz = 62;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) set(wx, 1, wz, M.Gloss, WELL_WATER, SHAPE_SLAB_BOTTOM);
      else set(wx + dx, 1, wz + dz, M.Matte, stone(wx + dx, 1, wz + dz));
    }
  }
  box(wx - 1, 2, wz, wx - 1, 3, wz, M.Matte, WOOD_DARK);
  box(wx + 1, 2, wz, wx + 1, 3, wz, M.Matte, WOOD_DARK);
  for (let x = wx - 2; x <= wx + 2; x++) {
    set(x, 4, wz - 1, M.Matte, WOOD, SHAPE_RAMP_PZ);
    set(x, 4, wz + 1, M.Matte, WOOD, SHAPE_RAMP_NZ);
    set(x, 4, wz, M.Matte, WOOD_DARK);
  }

  // market stall: posts, striped awning, counter with wares, crates
  for (const px of [60, 64]) {
    for (const pz of [35, 41]) box(px, 1, pz, px, 3, pz, M.Matte, WOOD_DARK);
  }
  for (let z = 35; z <= 41; z++) {
    for (let x = 59; x <= 65; x++) {
      set(x, 4, z, M.Matte, x & 1 ? RED : CREAM, SHAPE_SLAB_BOTTOM);
    }
  }
  box(60, 1, 38, 64, 1, 38, M.Matte, WOOD);
  set(61, 2, 38, M.Matte, GOLD);
  set(63, 2, 38, M.Matte, RED);
  box(57, 1, 44, 57, 2, 44, M.Matte, WOOD);
  set(58, 1, 45, M.Matte, WOOD_DARK);
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
