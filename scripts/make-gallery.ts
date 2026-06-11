/**
 * Builds every gallery scene into a Small world, encodes it as gzipped BBK v2,
 * and writes the payloads plus index.json into public/gallery/.
 *
 * Run with: bun run gallery
 */
import { mkdir } from "node:fs/promises";
import { AIR, applyWorldDims } from "../src/core/types";
import { VoxelWorld } from "../src/core/world";
import { encodeSnapshot } from "../src/io/codec";
import { GALLERY_SCENES } from "./gallery/all";
import { createSceneCtx } from "./gallery/scene";

interface IndexEntry {
  id: string;
  name: string;
  blurb: string;
  voxels: number;
  sx: number;
  sy: number;
  sz: number;
  bytes: number;
  thumb: string;
}

const outDir = new URL("../public/gallery/", import.meta.url);
await mkdir(outDir, { recursive: true });

const index: IndexEntry[] = [];
for (const scene of GALLERY_SCENES) {
  applyWorldDims(scene.cx, scene.cy, scene.cz);
  const world = new VoxelWorld();
  const ctx = createSceneCtx(
    scene.cx << 5,
    scene.cy << 5,
    scene.cz << 5,
    (x, y, z, cls, rgb, shape) => world.set(x, y, z, world.internState(cls, rgb, shape)),
    (x, y, z) => world.set(x, y, z, AIR),
  );
  scene.build(ctx);

  const snapshot = world.toSnapshot();
  const packed = Bun.gzipSync(encodeSnapshot(snapshot));
  const file = new URL(`${scene.id}.bbk.gz`, outDir);
  await Bun.write(file, packed);

  index.push({
    id: scene.id,
    name: scene.name,
    blurb: scene.blurb,
    voxels: world.voxelCount(),
    sx: snapshot.sx,
    sy: snapshot.sy,
    sz: snapshot.sz,
    bytes: packed.byteLength,
    thumb: `${scene.id}.png`,
  });
  console.log(
    `${scene.id}: ${world.voxelCount()} voxels, ${(packed.byteLength / 1024).toFixed(1)} KiB`,
  );
}

await Bun.write(new URL("index.json", outDir), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${index.length} scenes to public/gallery/`);
