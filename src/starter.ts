/**
 * First-run demo scene: a cozy hip-roofed cottage showing off the full vocabulary —
 * every material class (matte/gloss/emissive/glass plus the custom metal and water),
 * ramp + corner-hip roof, slab garden path and table, vertical-panel fence, and a
 * small pond — centered in the world.
 */
import {
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
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
  WORLD_SX,
  WORLD_SZ,
} from "./core/types";
import type { VoxelWorld } from "./core/world";

// Custom classes appended by main.ts right after the builtins. Registration order there is
// append-only (plasma, metal, water → 4, 5, 6), so these ids are stable across saves.
const METAL_CLASS = 5;
const WATER_CLASS = 6;

export const buildStarter = (world: VoxelWorld): void => {
  const id = (cls: number, rgb: number, shape = 0) => world.internState(cls, rgb, shape);
  const set = (x: number, y: number, z: number, s: number) => world.set(x, y, z, s);

  const box = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    s: number,
  ) => {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) set(x, y, z, s);
      }
    }
  };

  // ── palette ─────────────────────────────────────────────────────────────────

  const wall = id(MaterialClass.Matte, 0xe3dccd);
  const trim = id(MaterialClass.Matte, 0x8a6f55);
  const floorA = id(MaterialClass.Gloss, 0xc9c9c2);
  const floorB = id(MaterialClass.Gloss, 0x9a9a94);
  const glass = id(MaterialClass.Glass, 0x9fd9ec);
  const lamp = id(MaterialClass.Emissive, 0xffd9a0);
  const tableWood = id(MaterialClass.Matte, 0x8a5a3b);
  const trunk = id(MaterialClass.Matte, 0x6b4a2f);
  const leaf = id(MaterialClass.Matte, 0x4e9e4a);

  const tableTop = id(MaterialClass.Gloss, 0x6b4630, SHAPE_SLAB_BOTTOM);
  const pathSlab = id(MaterialClass.Gloss, 0x7e848c, SHAPE_SLAB_BOTTOM);
  const pondEdge = id(MaterialClass.Matte, 0x8d9298, SHAPE_SLAB_BOTTOM);

  const metal = id(METAL_CLASS, 0xc8ccd4);
  const water = id(WATER_CLASS, 0x3fa7d4, SHAPE_SLAB_BOTTOM);

  const roofRgb = 0xb5532a;
  const roofShape = (shape: number) => id(MaterialClass.Matte, roofRgb, shape);

  // ── house shell, centered on the baseplate ──────────────────────────────────

  const centerX = WORLD_SX >> 1;
  const centerZ = WORLD_SZ >> 1;
  const x0 = centerX - 6;
  const x1 = centerX + 6;
  const z0 = centerZ - 5;
  const z1 = centerZ + 5;
  const top = 5;

  // checkered floor
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) set(x, 0, z, (x + z) & 1 ? floorA : floorB);
  }

  // walls
  box(x0, 1, z0, x1, top, z0, wall);
  box(x0, 1, z1, x1, top, z1, wall);
  box(x0, 1, z0, x0, top, z1, wall);
  box(x1, 1, z0, x1, top, z1, wall);

  // door gap on the -z wall, framed in metal with a swung-open panel door
  for (let y = 1; y <= 3; y++) {
    for (let x = centerX - 1; x <= centerX + 1; x++) set(x, y, z0, 0);
  }
  box(centerX - 2, 1, z0, centerX - 2, 4, z0, metal);
  box(centerX + 2, 1, z0, centerX + 2, 4, z0, metal);
  box(centerX - 1, 4, z0, centerX + 1, 4, z0, metal);

  const doorLeaf = id(METAL_CLASS, 0x9aa1ab, SHAPE_VSLAB_NX);
  for (let y = 1; y <= 3; y++) set(centerX - 1, y, z0, doorLeaf);

  // windows: glass panes on the +z and -x walls
  box(x0 + 2, 2, z1, x0 + 5, 4, z1, glass);
  box(x1 - 5, 2, z1, x1 - 2, 4, z1, glass);
  box(x0, 2, z0 + 3, x0, 4, z1 - 3, glass);

  // ── hipped roof: ramp eaves, corner hips, cube core, slab ridge cap ─────────
  // Ramps rise toward the named axis; outer corners (h = min) rise toward the
  // named corner, so every layer's perimeter points at the ridge.

  for (let layer = 0; layer <= 4; layer++) {
    const y = top + 1 + layer;
    const rx0 = x0 + layer;
    const rx1 = x1 - layer;
    const rz0 = z0 + layer;
    const rz1 = z1 - layer;

    set(rx0, y, rz0, roofShape(SHAPE_CORNER_PXPZ));
    set(rx1, y, rz0, roofShape(SHAPE_CORNER_NXPZ));
    set(rx1, y, rz1, roofShape(SHAPE_CORNER_NXNZ));
    set(rx0, y, rz1, roofShape(SHAPE_CORNER_PXNZ));

    for (let x = rx0 + 1; x < rx1; x++) {
      set(x, y, rz0, roofShape(SHAPE_RAMP_PZ));
      set(x, y, rz1, roofShape(SHAPE_RAMP_NZ));
    }
    for (let z = rz0 + 1; z < rz1; z++) {
      set(rx0, y, z, roofShape(SHAPE_RAMP_PX));
      set(rx1, y, z, roofShape(SHAPE_RAMP_NX));
    }

    // solid core so the next layer has footing and the ceiling reads from inside
    box(rx0 + 1, y, rz0 + 1, rx1 - 1, y, rz1 - 1, roofShape(0));
  }

  // ridge cap along x where the two roof planes meet
  const ridge = roofShape(SHAPE_SLAB_BOTTOM);
  for (let x = x0 + 5; x <= x1 - 5; x++) set(x, top + 6, centerZ, ridge);

  // ── interior ────────────────────────────────────────────────────────────────

  // ceiling lamps tucked under the roof core
  set(x0 + 3, top, z0 + 3, lamp);
  set(x1 - 3, top, z0 + 3, lamp);
  set(x0 + 3, top, z1 - 2, lamp);
  set(x1 - 3, top, z1 - 2, lamp);

  // slab-top table on wooden legs
  set(centerX - 1, 1, z1 - 4, tableWood);
  set(centerX + 1, 1, z1 - 4, tableWood);
  set(centerX - 1, 1, z1 - 3, tableWood);
  set(centerX + 1, 1, z1 - 3, tableWood);
  box(centerX - 1, 2, z1 - 4, centerX + 1, 2, z1 - 3, tableTop);

  // ── garden ──────────────────────────────────────────────────────────────────

  // slab path from the door, flanked by metal lantern posts
  for (let z = z0 - 8; z < z0; z++) set(centerX, 0, z, pathSlab);

  for (const lx of [centerX - 2, centerX + 2]) {
    set(lx, 1, z0 - 3, metal);
    set(lx, 2, z0 - 3, lamp);
  }

  // vertical-panel fence across the front yard, with trim gate posts flanking the path
  const fenceZ = z0 - 9;
  const fencePanel = id(MaterialClass.Matte, 0x8a6f55, SHAPE_VSLAB_PZ);
  for (let x = centerX - 5; x <= centerX + 5; x++) {
    if (x >= centerX - 1 && x <= centerX + 1) continue;
    set(x, 1, fenceZ, x === centerX - 2 || x === centerX + 2 ? trim : fencePanel);
  }

  const fenceLeft = id(MaterialClass.Matte, 0x8a6f55, SHAPE_VSLAB_NX);
  const fenceRight = id(MaterialClass.Matte, 0x8a6f55, SHAPE_VSLAB_PX);
  for (let z = fenceZ + 1; z <= fenceZ + 2; z++) {
    set(centerX - 5, 1, z, fenceLeft);
    set(centerX + 5, 1, z, fenceRight);
  }

  // small pond by the east wall: slab water with a stone edging ring
  const px0 = x1 + 2;
  const px1 = x1 + 5;
  const pz0 = z0 - 3;
  const pz1 = z0;

  for (let z = pz0 - 1; z <= pz1 + 1; z++) {
    for (let x = px0 - 1; x <= px1 + 1; x++) {
      const inside = x >= px0 && x <= px1 && z >= pz0 && z <= pz1;
      const pondCorner = (x === px0 || x === px1) && (z === pz0 || z === pz1);
      if (inside && !pondCorner) set(x, 0, z, water);
      else set(x, 0, z, pondEdge);
    }
  }

  // trees
  const tree = (tx: number, tz: number) => {
    box(tx, 1, tz, tx, 3, tz, trunk);
    box(tx - 1, 3, tz - 1, tx + 1, 5, tz + 1, leaf);
    set(tx, 6, tz, leaf);
  };
  tree(x0 - 6, z0 + 1);
  tree(x1 + 6, z0 + 5);

  // rainbow arch over the path
  const archColors = [0xd94f3d, 0xe8943a, 0xeed75a, 0x7fbf4d, 0x3fa7c4, 0x7a5cc9];
  const archX = centerX - 3;
  const archZ = z0 - 6;

  for (let i = 0; i < 6; i++) {
    const s = id(MaterialClass.Matte, archColors[i]);
    set(archX + i, 4 + (i < 3 ? i : 5 - i), archZ, s);
  }
  for (let y = 1; y <= 3; y++) {
    set(archX, y, archZ, id(MaterialClass.Matte, archColors[0]));
    set(archX + 5, y, archZ, id(MaterialClass.Matte, archColors[5]));
  }
};
