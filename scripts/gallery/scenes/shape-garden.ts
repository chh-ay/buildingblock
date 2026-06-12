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
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
  SHAPE_VSLAB_NX,
  SHAPE_VSLAB_NZ,
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
} from "../scene";

const GRASS_A = 0x5d9c4c;
const GRASS_B = 0x549147;
const PATH = 0xb9b2a4;
const PATH_EDGE = 0xa39a89;
const GRAVEL = 0xb7ad94;
const BORDER = 0x8d9298;
const HEDGE_A = 0x36713a;
const HEDGE_B = 0x2e6233;
const POST = 0x6b4a2f;
const GAZEBO_WOOD = 0x8a5a3b;
const GAZEBO_ROOF = 0xb5532a;
const LANTERN = 0xffd9a0;
const LILY = 0x3f8f3f;
const LOTUS = 0xff8fb8;

const hash = (x: number, z: number): number => {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/**
 * One raised bed per material class, ordered as a 2×3 grid. Each bed holds a single
 * composed pavilion; the trim colour is what identifies the class at a glance.
 * Emissive is special-cased: a matte body with small lantern accents, never a glowing blob.
 */
interface Bed {
  x: number;
  z: number;
  cls: number;
  body: number;
  trim: number;
}

const BEDS: readonly Bed[] = [
  { x: 22, z: 20, cls: MaterialClass.Matte, body: 0xc4654a, trim: 0xf0e3c8 },
  { x: 74, z: 20, cls: MaterialClass.Gloss, body: 0x2fa6a0, trim: 0xeef3f2 },
  { x: 22, z: 48, cls: MaterialClass.Glass, body: 0x9fd4ec, trim: 0xd4ecf6 },
  { x: 74, z: 48, cls: CLS_METAL, body: 0xc8ccd4, trim: 0xb0793f },
  { x: 22, z: 76, cls: MaterialClass.Emissive, body: 0xe8dcc0, trim: 0xffb454 },
  { x: 74, z: 76, cls: CLS_PLASMA, body: 0xb45cff, trim: 0x5cd6ff },
];

const build = (ctx: SceneCtx): void => {
  const { set, box } = ctx;
  const M = MaterialClass;

  // ── lawn: two quiet greens, nothing scattered on top ────────────────────────
  for (let z = 6; z <= 89; z++) {
    for (let x = 6; x <= 89; x++) {
      set(x, 0, z, M.Matte, hash(x, z) % 3 === 0 ? GRASS_B : GRASS_A);
    }
  }

  // ── walks: main axis, two cross paths, and a connector to every bed ─────────
  const walk = (x: number, z: number, edge: boolean): void => {
    set(x, 1, z, M.Gloss, edge ? PATH_EDGE : PATH, SHAPE_SLAB_BOTTOM);
  };
  for (let z = 6; z <= 89; z++) {
    walk(47, z, false);
    walk(48, z, false);
  }
  for (let x = 10; x <= 86; x++) {
    for (const z of [33, 34, 61, 62]) walk(x, z, (x & 3) === 0 && (z === 33 || z === 62));
  }
  for (const bz of [20, 48, 76]) {
    for (let x = 30; x <= 46; x++) {
      for (let z = bz - 1; z <= bz + 1; z++) walk(x, z, z !== bz && (x & 3) === 0);
    }
    for (let x = 50; x <= 66; x++) {
      for (let z = bz - 1; z <= bz + 1; z++) walk(x, z, z !== bz && (x & 3) === 0);
    }
  }

  // ── hedge: vertical-slab perimeter, gates only on the main axis ─────────────
  const hedgeRow = (fixed: number, axis: "x" | "z", shape: number): void => {
    for (let i = 6; i <= 89; i++) {
      if (axis === "x" && (i === 47 || i === 48)) continue; // main-walk gates
      const [hx, hz] = axis === "x" ? [i, fixed] : [fixed, i];
      set(hx, 1, hz, M.Matte, hash(hx, hz) % 4 === 0 ? HEDGE_B : HEDGE_A, shape);
      if (axis === "x" && (i === 46 || i === 49)) {
        set(hx, 1, hz, M.Matte, POST);
        set(hx, 2, hz, M.Matte, POST, SHAPE_SLAB_BOTTOM);
      }
    }
  };
  hedgeRow(6, "x", SHAPE_VSLAB_PZ);
  hedgeRow(89, "x", SHAPE_VSLAB_NZ);
  hedgeRow(6, "z", SHAPE_VSLAB_PX);
  hedgeRow(89, "z", SHAPE_VSLAB_NX);
  for (const cx of [6, 89]) {
    for (const cz of [6, 89]) {
      box(cx, 1, cz, cx, 2, cz, M.Matte, HEDGE_B);
    }
  }

  // ── hipped-roof helper: ramp eaves + corner hips per shrinking ring ─────────
  const hip = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    cls: number,
    rgb: number,
    capCls: number,
    cap: number,
  ): void => {
    let [rx0, rz0, rx1, rz1] = [x0, z0, x1, z1];
    for (let y = y0; rx0 <= rx1 && rz0 <= rz1; y++) {
      if (rx0 === rx1 || rz0 === rz1) {
        box(rx0, y, rz0, rx1, y, rz1, capCls, cap, SHAPE_SLAB_BOTTOM); // ridge cap
        return;
      }
      set(rx0, y, rz0, cls, rgb, SHAPE_CORNER_PXPZ);
      set(rx1, y, rz0, cls, rgb, SHAPE_CORNER_NXPZ);
      set(rx1, y, rz1, cls, rgb, SHAPE_CORNER_NXNZ);
      set(rx0, y, rz1, cls, rgb, SHAPE_CORNER_PXNZ);
      for (let x = rx0 + 1; x < rx1; x++) {
        set(x, y, rz0, cls, rgb, SHAPE_RAMP_PZ);
        set(x, y, rz1, cls, rgb, SHAPE_RAMP_NZ);
      }
      for (let z = rz0 + 1; z < rz1; z++) {
        set(rx0, y, z, cls, rgb, SHAPE_RAMP_PX);
        set(rx1, y, z, cls, rgb, SHAPE_RAMP_NX);
      }
      box(rx0 + 1, y, rz0 + 1, rx1 - 1, y, rz1 - 1, cls, rgb);
      rx0++;
      rz0++;
      rx1--;
      rz1--;
    }
  };

  // ── one raised bed: bordered gravel pad + a single composed pavilion ────────
  // Cube plinth, four cube posts capped by the roof's corner hips, vslab screen
  // walls on three sides, full hip-ring roof, ramp steps facing the main axis.
  const bed = ({ x: bx, z: bz, cls, body, trim }: Bed): void => {
    const emissive = cls === M.Emissive;
    const bodyCls = emissive ? M.Matte : cls; // emissive bed: matte body, lantern trim
    const front = bx < 48 ? 1 : -1; // beds open toward the central axis

    // slab-bordered gravel pad
    for (let z = bz - 7; z <= bz + 7; z++) {
      for (let x = bx - 7; x <= bx + 7; x++) {
        const onBorder = x === bx - 7 || x === bx + 7 || z === bz - 7 || z === bz + 7;
        set(x, 1, z, M.Matte, onBorder ? BORDER : GRAVEL, SHAPE_SLAB_BOTTOM);
      }
    }

    // cube plinth with ramp steps up the open side
    box(bx - 3, 1, bz - 3, bx + 3, 1, bz + 3, bodyCls, body);
    for (let z = bz - 1; z <= bz + 1; z++) {
      set(bx + 4 * front, 1, z, bodyCls, body, front > 0 ? SHAPE_RAMP_NX : SHAPE_RAMP_PX);
    }

    // four cube posts; the roof's corner hips land on them as caps
    for (const px of [bx - 2, bx + 2]) {
      for (const pz of [bz - 2, bz + 2]) {
        box(px, 2, pz, px, 3, pz, bodyCls, body);
      }
    }

    // vslab screen walls in trim colour on the three closed sides
    const back = bx - 2 * front;
    const backShape = front > 0 ? SHAPE_VSLAB_NX : SHAPE_VSLAB_PX;
    const wallCls = emissive ? M.Matte : cls;
    const wallRgb = emissive ? 0xd2bf96 : trim;
    box(back, 2, bz - 1, back, 3, bz + 1, wallCls, wallRgb, backShape);
    box(bx - 1, 2, bz - 2, bx + 1, 3, bz - 2, wallCls, wallRgb, SHAPE_VSLAB_NZ);
    box(bx - 1, 2, bz + 2, bx + 1, 3, bz + 2, wallCls, wallRgb, SHAPE_VSLAB_PZ);

    // full hip-ring roof; the ridge cap carries the identifying trim
    const capCls = emissive ? M.Emissive : cls;
    hip(bx - 2, bz - 2, bx + 2, bz + 2, 4, bodyCls, body, capCls, trim);

    // display pedestal under the cap
    set(bx, 2, bz, bodyCls, body);
    set(bx, 3, bz, capCls, trim, SHAPE_SLAB_BOTTOM);

    // gate posts flanking the steps: cubes with corner-wedge caps
    const gx = bx + 6 * front;
    for (const [gz, capShape] of [
      [bz - 2, front > 0 ? SHAPE_CORNER_PXPZ : SHAPE_CORNER_NXPZ],
      [bz + 2, front > 0 ? SHAPE_CORNER_PXNZ : SHAPE_CORNER_NXNZ],
    ]) {
      box(gx, 1, gz, gx, 2, gz, bodyCls, body);
      if (emissive) {
        set(gx, 3, gz, M.Emissive, trim); // small gate lanterns
        set(gx, 4, gz, M.Matte, POST, SHAPE_SLAB_BOTTOM);
      } else {
        set(gx, 3, gz, cls, trim, capShape);
      }
    }
  };
  for (const b of BEDS) bed(b);

  // ── central gazebo: slab deck, railed posts, tall hipped crown, lantern ─────
  box(43, 1, 43, 53, 1, 53, M.Gloss, 0xcfc8b8, SHAPE_SLAB_BOTTOM);
  for (const gx of [44, 52]) {
    for (const gz of [44, 52]) {
      box(gx, 1, gz, gx, 5, gz, M.Matte, GAZEBO_WOOD);
    }
  }
  for (let i = 45; i <= 51; i++) {
    if (i >= 47 && i <= 49) continue; // keep the four walk entries open
    set(i, 2, 44, M.Matte, GAZEBO_WOOD, SHAPE_VSLAB_NZ);
    set(i, 2, 52, M.Matte, GAZEBO_WOOD, SHAPE_VSLAB_PZ);
    set(44, 2, i, M.Matte, GAZEBO_WOOD, SHAPE_VSLAB_NX);
    set(52, 2, i, M.Matte, GAZEBO_WOOD, SHAPE_VSLAB_PX);
  }
  hip(43, 43, 53, 53, 6, M.Matte, GAZEBO_ROOF, M.Matte, 0xd97a3f);
  set(48, 5, 48, M.Emissive, LANTERN);
  set(48, 4, 48, M.Matte, POST, SHAPE_SLAB_TOP);

  // ── lily pond on the south axis: sunken water under a stone edging ring ─────
  const inPond = (x: number, z: number): boolean =>
    ((x - 48) / 8.5) ** 2 + ((z - 76) / 6.5) ** 2 <= 1;
  for (let z = 68; z <= 84; z++) {
    for (let x = 38; x <= 58; x++) {
      if (!inPond(x, z)) continue;
      set(x, 0, z, CLS_WATER, hash(x, z) % 7 === 0 ? 0x2e8fc4 : 0x3fa7d4, SHAPE_SLAB_BOTTOM);
      const rim = !inPond(x - 1, z) || !inPond(x + 1, z) || !inPond(x, z - 1) || !inPond(x, z + 1);
      if (rim) set(x, 1, z, M.Matte, BORDER, SHAPE_SLAB_BOTTOM);
    }
  }
  for (const [lx, lz, bloom] of [
    [44, 73, 0],
    [52, 74, 1],
    [46, 79, 1],
    [51, 79, 0],
    [48, 72, 0],
  ]) {
    set(lx, 0, lz, M.Matte, LILY, SHAPE_SLAB_TOP);
    if (bloom) set(lx, 1, lz, M.Emissive, LOTUS, SHAPE_SLAB_BOTTOM);
  }
  // boardwalk planks re-laid over the water so the stroll crosses the pond
  for (let z = 70; z <= 82; z++) {
    walk(47, z, false);
    walk(48, z, false);
  }
  for (let x = 40; x <= 56; x++) walk(x, 76, false);

  // ── lanterns flanking the gazebo plaza ──────────────────────────────────────
  for (const lx of [41, 55]) {
    for (const lz of [41, 55]) {
      box(lx, 1, lz, lx, 2, lz, CLS_METAL, 0x9aa1ab);
      set(lx, 3, lz, M.Emissive, LANTERN);
      set(lx, 4, lz, CLS_METAL, 0x9aa1ab, SHAPE_SLAB_BOTTOM);
    }
  }
};

export const scene: SceneSpec = {
  id: "shape-garden",
  name: "Shape Garden",
  blurb: "every block, every material, one stroll",
  cx: 3,
  cy: 2,
  cz: 3,
  build,
};
