import type { SceneCtx, SceneSpec } from "../scene";
import {
  MaterialClass,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_PX,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
} from "../scene";

const SNOW = 0xeef1f4;
const SNOW_SHADE = 0xdde4ea;
const ICE_DEEP = 0x6d96b4;
const ICE_SURFACE = 0xc6e2ef;
const WOOD_A = 0x7a553a;
const WOOD_B = 0x8f6748;
const WOOD_DARK = 0x4a3526;
const STONE = 0x9aa0a8;
const STONE_DARK = 0x7d8087;
const PINE = 0x2f5d3a;
const GLOW = 0xffc97e;
const SMOKE = 0xc9cdd2;

const hash = (x: number, z: number): number => {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
};

// rounded ground pad with a jittered organic edge
const onPad = (x: number, z: number): boolean => {
  const nx = (x - 48) / 33;
  const nz = (z - 48) / 33;
  const wobble = ((hash(x, z) % 100) / 100) * 0.1;
  return nx ** 4 + nz ** 4 <= 1 - wobble;
};

const inPond = (x: number, z: number): boolean =>
  ((x - 66) / 9.5) ** 2 + ((z - 66) / 7.5) ** 2 <= 1;

const build = (ctx: SceneCtx): void => {
  const { set, box } = ctx;
  const M = MaterialClass;

  // ground: two snow layers, frozen pond carved into the far corner
  for (let z = 14; z <= 82; z++) {
    for (let x = 14; x <= 82; x++) {
      if (!onPad(x, z)) continue;
      if (inPond(x, z)) {
        set(x, 0, z, M.Gloss, ICE_DEEP);
        set(x, 1, z, M.Glass, ICE_SURFACE);
      } else {
        set(x, 0, z, M.Matte, SNOW_SHADE);
        set(x, 1, z, M.Matte, (x + z) & 1 ? SNOW : SNOW_SHADE);
        if (hash(x * 3 + 1, z) % 41 === 0) set(x, 2, z, M.Matte, SNOW, SHAPE_SLAB_BOTTOM);
      }
    }
  }

  // rocks around the pond rim
  for (const [rx, rz] of [
    [57, 63],
    [60, 74],
    [74, 59],
    [70, 75],
  ]) {
    set(rx, 2, rz, M.Matte, STONE_DARK, SHAPE_SLAB_BOTTOM);
  }

  // stepping-stone footpath from the door to the pad edge
  for (let z = 20; z <= 44; z += 2) {
    const x = 49 - ((z >> 2) & 1);
    set(x, 2, z, M.Matte, STONE, SHAPE_SLAB_BOTTOM);
  }

  // cabin: alternating log courses with corner crossings
  const x0 = 44;
  const x1 = 56;
  const z0 = 46;
  const z1 = 56;
  for (let y = 2; y <= 7; y++) {
    const tone = y & 1 ? WOOD_A : WOOD_B;
    const longX = (y & 1) === 0; // which log direction overhangs the corners
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!longX && (x < x0 || x > x1)) continue;
      set(x, y, z0, M.Matte, tone);
      set(x, y, z1, M.Matte, tone);
    }
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      if (longX && (z < z0 || z > z1)) continue;
      set(x0, y, z, M.Matte, tone);
      set(x1, y, z, M.Matte, tone);
    }
  }

  // warm windows, door, awning
  box(46, 4, z0, 47, 5, z0, M.Emissive, GLOW);
  box(53, 4, z0, 54, 5, z0, M.Emissive, GLOW);
  box(x0, 4, 50, x0, 5, 51, M.Emissive, GLOW);
  box(x1, 4, 50, x1, 5, 51, M.Emissive, GLOW);
  box(49, 2, z0, 50, 4, z0, M.Matte, WOOD_DARK);
  box(48, 5, z0 - 1, 51, 5, z0 - 1, M.Matte, WOOD_DARK, SHAPE_SLAB_BOTTOM);

  // gable end walls (ridge runs along z)
  for (let j = 0; j <= 5; j++) {
    const tone = j & 1 ? WOOD_B : WOOD_A;
    box(x0 + j, 8 + j, z0, x1 - j, 8 + j, z0, M.Matte, tone);
    box(x0 + j, 8 + j, z1, x1 - j, 8 + j, z1, M.Matte, tone);
  }

  // roof slopes with snow capping, ridge row on top
  for (let i = 0; i <= 6; i++) {
    const y = 8 + i;
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      set(43 + i, y, z, M.Matte, WOOD_DARK, SHAPE_RAMP_PX);
      set(57 - i, y, z, M.Matte, WOOD_DARK, SHAPE_RAMP_NX);
      set(43 + i, y + 1, z, M.Matte, SNOW, SHAPE_SLAB_TOP);
      set(57 - i, y + 1, z, M.Matte, SNOW, SHAPE_SLAB_TOP);
    }
  }
  box(50, 14, z0 - 1, 50, 14, z1 + 1, M.Matte, WOOD_DARK);
  box(50, 15, z0 - 1, 50, 15, z1 + 1, M.Matte, SNOW, SHAPE_SLAB_BOTTOM);

  // stone chimney punching through the east slope, smoke drifting downwind
  box(52, 2, 52, 53, 15, 53, M.Matte, STONE_DARK);
  const puffs: Array<[number, number, number, number]> = [
    [52, 17, 53, 1],
    [53, 20, 52, 1],
    [55, 23, 51, 0],
    [56, 26, 50, 0],
  ];
  for (const [px, py, pz, r] of puffs) {
    set(px, py, pz, M.Matte, SMOKE);
    if (r > 0) {
      set(px + 1, py, pz, M.Matte, SMOKE);
      set(px - 1, py, pz, M.Matte, SMOKE);
      set(px, py, pz + 1, M.Matte, SMOKE);
      set(px, py, pz - 1, M.Matte, SMOKE);
    }
  }

  // snow-dusted pines from a per-tier radius table
  const pine = (cx: number, cz: number): void => {
    box(cx, 2, cz, cx, 4, cz, M.Matte, WOOD_DARK);
    const radii = [3, 3, 2, 2, 1, 1];
    for (let k = 0; k < radii.length; k++) {
      const r = radii[k];
      const y = 4 + k;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > r * r + 1) continue;
          set(cx + dx, y, cz + dz, M.Matte, PINE);
          // dust the exposed outer ring of each tier
          const exposed = k === radii.length - 1 || radii[k + 1] < r;
          if (exposed && d2 >= (r - 1) * (r - 1) + 1 && hash(cx + dx, cz + dz) % 2 === 0) {
            set(cx + dx, y + 1, cz + dz, M.Matte, SNOW, SHAPE_SLAB_BOTTOM);
          }
        }
      }
    }
    set(cx, 4 + radii.length, cz, M.Matte, PINE);
    set(cx, 5 + radii.length, cz, M.Matte, SNOW, SHAPE_SLAB_BOTTOM);
  };
  pine(26, 28);
  pine(72, 26);
  pine(24, 58);
  pine(36, 74);
  pine(66, 46);

  // lamppost beside the path
  box(52, 2, 30, 52, 5, 30, M.Matte, WOOD_DARK);
  set(52, 6, 30, M.Emissive, GLOW);
  set(52, 7, 30, M.Matte, WOOD_DARK, SHAPE_SLAB_BOTTOM);

  // log pile against the west wall, axe stump nearby
  box(39, 2, 48, 39, 2, 53, M.Matte, WOOD_A);
  box(40, 2, 48, 40, 2, 53, M.Matte, WOOD_B);
  box(40, 3, 49, 40, 3, 52, M.Matte, WOOD_A);
  set(37, 2, 58, M.Matte, WOOD_B);
  set(37, 3, 58, M.Matte, STONE_DARK, SHAPE_SLAB_BOTTOM); // axe head resting on the stump
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
