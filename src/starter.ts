/** First-run demo scene: a small furnished house showing every material class, centered in the world. */
import { MaterialClass, WORLD_SX, WORLD_SZ } from "./core/types";
import type { VoxelWorld } from "./core/world";

export const buildStarter = (world: VoxelWorld): void => {
  const id = (cls: number, rgb: number) => world.internState(cls, rgb);
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

  const wall = id(MaterialClass.Matte, 0xe3dccd);
  const trim = id(MaterialClass.Matte, 0x8a6f55);
  const floorA = id(MaterialClass.Gloss, 0xc9c9c2);
  const floorB = id(MaterialClass.Gloss, 0x9a9a94);
  const roof = id(MaterialClass.Matte, 0xb5532a);
  const glass = id(MaterialClass.Glass, 0x9fd9ec);
  const lamp = id(MaterialClass.Emissive, 0xffd9a0);
  const tableWood = id(MaterialClass.Matte, 0x8a5a3b);
  const tableTop = id(MaterialClass.Gloss, 0x6b4630);
  const trunk = id(MaterialClass.Matte, 0x6b4a2f);
  const leaf = id(MaterialClass.Matte, 0x4e9e4a);
  const stone = id(MaterialClass.Gloss, 0x7e848c);

  // house shell centered on the baseplate
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

  // door gap on the -z wall
  for (let y = 1; y <= 3; y++) {
    for (let x = centerX - 1; x <= centerX + 1; x++) set(x, y, z0, 0);
  }
  set(centerX - 2, 4, z0, trim);
  set(centerX + 2, 4, z0, trim);

  // windows: glass panes on the +z and -x walls
  box(x0 + 2, 2, z1, x0 + 5, 4, z1, glass);
  box(x1 - 5, 2, z1, x1 - 2, 4, z1, glass);
  box(x0, 2, z0 + 3, x0, 4, z1 - 3, glass);

  // flat roof with trim border
  box(x0, top + 1, z0, x1, top + 1, z1, roof);
  box(x0 + 1, top + 1, z0 + 1, x1 - 1, top + 1, z1 - 1, trim);

  // ceiling lamps
  set(x0 + 3, top, z0 + 3, lamp);
  set(x1 - 3, top, z0 + 3, lamp);
  set(x0 + 3, top, z1 - 2, lamp);
  set(x1 - 3, top, z1 - 2, lamp);

  // table with a lamp
  box(centerX - 1, 1, z1 - 4, centerX + 1, 1, z1 - 3, tableWood);
  box(centerX - 2, 2, z1 - 5, centerX + 2, 2, z1 - 2, tableTop);
  set(centerX, 3, z1 - 4, lamp);

  // stone path from the door
  for (let z = z0 - 8; z < z0; z++) set(centerX, 0, z, stone);

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
