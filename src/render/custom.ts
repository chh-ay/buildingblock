/**
 * Custom material-class hook ("attach your own shader"): appends a material class to the
 * class table, binds a render bucket with a user TSL node material, and triggers a remesh.
 * Voxels painted with the class route to the new bucket via the mesher.
 */
import type { Material } from "three";
import { float, mix, positionWorld, sin, time, vec3 } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { appendClass } from "../core/types";
import type { RemeshScheduler } from "../mesh/scheduler";
import type { AppState } from "../state";
import type { ChunkRenderer } from "./chunks";
import { linearVertexColor } from "./materials";

export interface CustomMaterialDef {
  name: string;
  /** Occludes neighbors (face culling + AO) like solid blocks. */
  opaque: boolean;
  gloss?: boolean;
  emissive?: boolean;
  makeMaterial(): Material;
}

export interface CustomMaterialDeps {
  chunks: ChunkRenderer;
  scheduler: RemeshScheduler;
  state: AppState;
}

/** Registers a block material class; returns its class id and remeshes the world. */
export const registerBlockMaterial = (def: CustomMaterialDef, deps: CustomMaterialDeps): number => {
  const bucket = deps.chunks.addBucket(def.makeMaterial());
  const table = appendClass(deps.scheduler.classTable, {
    opaque: def.opaque,
    bucket,
    gloss: def.gloss,
    emissive: def.emissive,
  });
  const classId = table.opaque.length - 1;
  deps.scheduler.setClasses(table);
  deps.state.classes.set([...deps.state.classes(), { id: classId, name: def.name }]);
  return classId;
};

/** Demo TSL material: animated plasma glow tinted by the painted vertex color. */
export const plasmaMaterialDef = (): CustomMaterialDef => ({
  name: "Plasma",
  opaque: true,
  makeMaterial: () => {
    const material = new MeshStandardNodeMaterial();
    const paintedColor = linearVertexColor();
    const wavePosition = positionWorld.mul(0.55);
    const wave = sin(wavePosition.x.add(time.mul(1.8)))
      .add(sin(wavePosition.y.mul(1.3).add(time.mul(1.3))))
      .add(sin(wavePosition.z.mul(0.9).add(time.mul(0.8))))
      .mul(1 / 6)
      .add(0.5);
    material.colorNode = paintedColor.mul(0.22);
    material.emissiveNode = mix(vec3(0.15, 0.4, 1.4), vec3(1.4, 0.25, 0.9), wave)
      .mul(paintedColor.add(0.3))
      .mul(1.5);
    material.roughnessNode = float(0.35);
    return material;
  },
});
