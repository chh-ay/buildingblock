import type { SceneCtx, SceneSpec } from "../scene";
import { MaterialClass, SHAPE_SLAB_BOTTOM, SHAPE_SLAB_TOP } from "../scene";

const STREET = 0x14161a;
const SIDEWALK = 0x2c3038;
const PUDDLE = 0x222b38;
const CONCRETE_A = 0x2a2e36;
const CONCRETE_B = 0x3a3f49;
const TRIM = 0x1d212a;
const GLASS_DARK = 0x18202c;
const NEON_MAGENTA = 0xe65bb4;
const NEON_CYAN = 0x69e0e6;
const WINDOW_WARM = 0xffc46e;
const CORAL = 0xd96a5a;
const RUST = 0x7a5240;
const CRATE = 0x8a5a3b;

const PAD_X0 = 16;
const PAD_X1 = 78;
const PAD_Z0 = 12;
const PAD_Z1 = 82;

interface Tower {
  x0: number;
  z0: number;
  w: number;
  d: number;
  h: number;
  rgb: number;
}

// Four blocks staggered around a narrow alley at x 37..45.
const TOWERS: readonly Tower[] = [
  { x0: 24, z0: 20, w: 13, d: 14, h: 44, rgb: CONCRETE_A },
  { x0: 46, z0: 18, w: 15, d: 14, h: 34, rgb: CONCRETE_B },
  { x0: 22, z0: 56, w: 14, d: 15, h: 24, rgb: CONCRETE_B },
  { x0: 48, z0: 54, w: 14, d: 16, h: 48, rgb: CONCRETE_A },
];

const buildGround = (ctx: SceneCtx): void => {
  // Gloss asphalt with a matte sidewalk border (no overlapping writes).
  ctx.box(PAD_X0 + 2, 0, PAD_Z0 + 2, PAD_X1 - 2, 0, PAD_Z1 - 2, MaterialClass.Gloss, STREET);
  ctx.box(PAD_X0, 0, PAD_Z0, PAD_X1, 0, PAD_Z0 + 1, MaterialClass.Matte, SIDEWALK);
  ctx.box(PAD_X0, 0, PAD_Z1 - 1, PAD_X1, 0, PAD_Z1, MaterialClass.Matte, SIDEWALK);
  ctx.box(PAD_X0, 0, PAD_Z0 + 2, PAD_X0 + 1, 0, PAD_Z1 - 2, MaterialClass.Matte, SIDEWALK);
  ctx.box(PAD_X1 - 1, 0, PAD_Z0 + 2, PAD_X1, 0, PAD_Z1 - 2, MaterialClass.Matte, SIDEWALK);

  // Rain puddles: irregular gloss blobs slightly lighter than the asphalt.
  const puddles: ReadonlyArray<readonly [number, number, number, number]> = [
    [40, 40, 4, 3],
    [42, 50, 3, 4],
    [62, 36, 4, 3],
  ];
  for (const [px, pz, rx, rz] of puddles) {
    for (let z = pz - rz; z <= pz + rz; z++) {
      for (let x = px - rx; x <= px + rx; x++) {
        const nx = (x - px) / rx;
        const nz = (z - pz) / rz;
        const wobble = (((x * 11 + z * 17) % 3) - 1) * 0.2;
        if (nx * nx + nz * nz > 1 + wobble) continue;
        ctx.set(x, 0, z, MaterialClass.Gloss, PUDDLE);
      }
    }
  }
};

const buildTower = (ctx: SceneCtx, t: Tower): void => {
  const x1 = t.x0 + t.w - 1;
  const z1 = t.z0 + t.d - 1;
  for (let y = 1; y <= t.h; y++) {
    for (let z = t.z0; z <= z1; z++) {
      for (let x = t.x0; x <= x1; x++) {
        const onX = x === t.x0 || x === x1;
        const onZ = z === t.z0 || z === z1;
        if (!onX && !onZ) continue;
        const corner = onX && onZ;
        // Window bands: alternating pier/window columns, a floor slab line every 4th row,
        // dark storefront below y=3 and a solid crown row at the top.
        const windowCell = !corner && y >= 3 && y <= t.h - 2 && y % 4 !== 0 && (x + z) % 2 === 0;
        if (!windowCell) {
          const rgb = y <= 2 ? TRIM : t.rgb;
          ctx.set(x, y, z, MaterialClass.Matte, rgb);
          continue;
        }
        if ((x * 7 + y * 13 + z * 3) % 9 === 0) {
          const warm = (x * 5 + y * 11 + z * 7) % 3 === 0;
          ctx.set(x, y, z, MaterialClass.Emissive, warm ? WINDOW_WARM : NEON_CYAN);
        } else {
          ctx.set(x, y, z, MaterialClass.Glass, GLASS_DARK);
        }
      }
    }
  }
  // Roof deck and parapet lip.
  ctx.box(t.x0 + 1, t.h, t.z0 + 1, x1 - 1, t.h, z1 - 1, MaterialClass.Matte, TRIM);
  ctx.box(t.x0, t.h + 1, t.z0, x1, t.h + 1, t.z0, MaterialClass.Matte, t.rgb, SHAPE_SLAB_BOTTOM);
  ctx.box(t.x0, t.h + 1, z1, x1, t.h + 1, z1, MaterialClass.Matte, t.rgb, SHAPE_SLAB_BOTTOM);
  ctx.box(
    t.x0,
    t.h + 1,
    t.z0 + 1,
    t.x0,
    t.h + 1,
    z1 - 1,
    MaterialClass.Matte,
    t.rgb,
    SHAPE_SLAB_BOTTOM,
  );
  ctx.box(
    x1,
    t.h + 1,
    t.z0 + 1,
    x1,
    t.h + 1,
    z1 - 1,
    MaterialClass.Matte,
    t.rgb,
    SHAPE_SLAB_BOTTOM,
  );
  // Sidewalk apron hugging the base.
  ctx.box(
    t.x0 - 1,
    1,
    t.z0 - 1,
    x1 + 1,
    1,
    t.z0 - 1,
    MaterialClass.Matte,
    SIDEWALK,
    SHAPE_SLAB_BOTTOM,
  );
  ctx.box(t.x0 - 1, 1, z1 + 1, x1 + 1, 1, z1 + 1, MaterialClass.Matte, SIDEWALK, SHAPE_SLAB_BOTTOM);
  ctx.box(t.x0 - 1, 1, t.z0, t.x0 - 1, 1, z1, MaterialClass.Matte, SIDEWALK, SHAPE_SLAB_BOTTOM);
  ctx.box(x1 + 1, 1, t.z0, x1 + 1, 1, z1, MaterialClass.Matte, SIDEWALK, SHAPE_SLAB_BOTTOM);
};

const buildSigns = (ctx: SceneCtx): void => {
  // Magenta strip on tower A's alley facade (east wall at x=36).
  ctx.box(37, 7, 23, 37, 7, 31, MaterialClass.Emissive, NEON_MAGENTA);
  // Cyan strip over tower D's cross-street facade (north wall at z=54).
  ctx.box(51, 9, 53, 59, 9, 53, MaterialClass.Emissive, NEON_CYAN);
  // Vertical sign hung off tower B's alley corner, alternating colours.
  for (let y = 6; y <= 16; y++) {
    ctx.set(45, y, 21, MaterialClass.Emissive, y & 1 ? NEON_MAGENTA : NEON_CYAN);
  }
  ctx.set(45, 17, 21, MaterialClass.Matte, TRIM, SHAPE_SLAB_BOTTOM);
};

const buildNoodleStall = (ctx: SceneCtx): void => {
  // Tiny stall tucked against tower A's south wall in the cross street.
  ctx.box(27, 1, 34, 33, 1, 35, MaterialClass.Matte, TRIM);
  ctx.box(27, 2, 34, 33, 2, 34, MaterialClass.Matte, CRATE);
  ctx.set(27, 3, 35, MaterialClass.Matte, TRIM);
  ctx.set(33, 3, 35, MaterialClass.Matte, TRIM);
  ctx.box(26, 4, 34, 34, 4, 36, MaterialClass.Matte, CORAL, SHAPE_SLAB_TOP);
  ctx.set(30, 3, 35, MaterialClass.Emissive, WINDOW_WARM);
  // Crates stacked beside the stall.
  ctx.set(35, 1, 35, MaterialClass.Matte, CRATE);
  ctx.set(36, 1, 34, MaterialClass.Matte, CRATE);
  ctx.set(35, 2, 35, MaterialClass.Matte, CRATE, SHAPE_SLAB_BOTTOM);
};

const buildFireEscape = (ctx: SceneCtx): void => {
  // Slab landings zig-zagging up tower B's alley wall (x=46).
  for (let i = 0; i < 4; i++) {
    const y = 8 + i * 6;
    const z0 = i % 2 === 0 ? 20 : 25;
    ctx.box(45, y, z0, 45, y, z0 + 3, MaterialClass.Matte, TRIM, SHAPE_SLAB_BOTTOM);
    ctx.set(45, y, i % 2 === 0 ? z0 + 4 : z0 - 1, MaterialClass.Matte, TRIM, SHAPE_SLAB_TOP);
  }
};

const buildRoofProps = (ctx: SceneCtx): void => {
  // Water tower on the low roof (tower C, h=24): slab legs, rust drum, slab cap.
  for (const x of [26, 29]) {
    for (const z of [60, 63]) ctx.set(x, 25, z, MaterialClass.Matte, TRIM);
  }
  ctx.box(26, 26, 60, 29, 28, 63, MaterialClass.Matte, RUST);
  ctx.box(26, 29, 60, 29, 29, 63, MaterialClass.Matte, TRIM, SHAPE_SLAB_BOTTOM);
  // AC boxes.
  ctx.box(50, 35, 22, 52, 36, 24, MaterialClass.Matte, TRIM);
  ctx.set(53, 35, 26, MaterialClass.Matte, CONCRETE_A);
  ctx.box(52, 49, 58, 54, 49, 60, MaterialClass.Matte, CONCRETE_B);
  // Antenna with a warm beacon on the tallest tower.
  ctx.box(57, 49, 66, 57, 52, 66, MaterialClass.Matte, TRIM);
  ctx.set(57, 53, 66, MaterialClass.Emissive, WINDOW_WARM, SHAPE_SLAB_BOTTOM);
};

const build = (ctx: SceneCtx): void => {
  buildGround(ctx);
  for (const t of TOWERS) buildTower(ctx, t);
  buildSigns(ctx);
  buildNoodleStall(ctx);
  buildFireEscape(ctx);
  buildRoofProps(ctx);
};

export const scene: SceneSpec = {
  id: "neon-city",
  name: "Neon Alley",
  blurb: "rain-slick block at midnight",
  cx: 3,
  cy: 2,
  cz: 3,
  build,
};
