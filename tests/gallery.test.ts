/** Every gallery scene must build in bounds, carry real content, and survive a codec roundtrip. */
import { describe, expect, test } from "bun:test";
import { GALLERY_SCENES } from "../scripts/gallery/all";
import { createSceneCtx } from "../scripts/gallery/scene";
import { AIR, applyWorldDims, SHAPE_COUNT, stateRgb } from "../src/core/types";
import { VoxelWorld } from "../src/core/world";
import { decodeSnapshot, encodeSnapshot } from "../src/io/codec";

describe("gallery scenes", () => {
  test("registry has six uniquely-named scenes", () => {
    expect(GALLERY_SCENES.length).toBe(6);
    const ids = new Set(GALLERY_SCENES.map((s) => s.id));
    expect(ids.size).toBe(GALLERY_SCENES.length);
    for (const scene of GALLERY_SCENES) {
      expect(scene.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(scene.name.length).toBeGreaterThan(2);
      expect(scene.blurb.length).toBeGreaterThan(4);
    }
  });

  for (const scene of GALLERY_SCENES) {
    test(`${scene.id} builds and roundtrips`, () => {
      applyWorldDims(scene.cx, scene.cy, scene.cz);
      const world = new VoxelWorld();
      let writes = 0;
      const ctx = createSceneCtx(
        scene.cx << 5,
        scene.cy << 5,
        scene.cz << 5,
        (x, y, z, cls, rgb, shape) => {
          expect(shape).toBeGreaterThanOrEqual(0);
          expect(shape).toBeLessThan(SHAPE_COUNT);
          expect(rgb).toBeGreaterThanOrEqual(0);
          expect(rgb).toBeLessThanOrEqual(0xffffff);
          world.set(x, y, z, world.internState(cls, rgb, shape));
          writes++;
        },
        (x, y, z) => world.set(x, y, z, AIR),
      );
      scene.build(ctx);

      // Substantial content, but nowhere near pathological for a shared download.
      expect(writes).toBeGreaterThan(400);
      const voxels = world.voxelCount();
      expect(voxels).toBeGreaterThan(400);

      // Scenes should use a real palette, not a single colour.
      const colors = new Set(world.stateTable.map((key) => stateRgb(key)));
      expect(colors.size).toBeGreaterThan(4);

      const bytes = encodeSnapshot(world.toSnapshot());
      const decoded = decodeSnapshot(bytes);
      expect(decoded.sx).toBe(scene.cx << 5);
      const reencoded = encodeSnapshot(decoded);
      expect(reencoded).toEqual(bytes);
    });
  }
});
