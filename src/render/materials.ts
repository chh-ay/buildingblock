/**
 * Node materials for the built-in buckets (TSL — compiles to WGSL on WebGPU, GLSL on the
 * WebGL2 fallback). Vertex attributes per src/core/types.ts BucketGeometry:
 * color = u8x4 sRGB (normalized), extra = u8x4 [ao, gloss, emissive, 0] (normalized).
 */
import { SRGBColorSpace } from "three";
import { attribute, colorSpaceToWorking, float, mix } from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";

/**
 * Painted vertex color (u8x4 sRGB attribute) decoded into the linear working space.
 * Cast note: @types/three declares colorSpaceToWorking as a bare ColorSpaceNode, but at
 * runtime TSL wraps it in the fluent vec3-typed proxy — the assertion restores that type.
 */
export const linearVertexColor = (): Node<"vec3"> =>
  colorSpaceToWorking(
    attribute<"vec4">("color", "vec4").rgb,
    SRGBColorSpace,
  ) as unknown as Node<"vec3">;

export const createOpaqueMaterial = (): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial();
  const albedo = linearVertexColor();
  const extra = attribute<"vec4">("extra", "vec4");
  material.colorNode = albedo;
  // Baked voxel AO attenuates indirect light (aoNode), remapped so corners stay readable.
  material.aoNode = mix(float(0.25), float(1.0), extra.x);
  material.roughnessNode = mix(float(0.82), float(0.16), extra.y);
  material.metalnessNode = extra.y.mul(0.12);
  // Emissive blocks burn above 1.0 so the bloom threshold picks them up.
  material.emissiveNode = albedo.mul(extra.z.mul(2.2));
  return material;
};

export const createGlassMaterial = (): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = linearVertexColor();
  material.roughnessNode = float(0.08);
  material.metalnessNode = float(0);
  material.transparent = true;
  material.opacity = 0.45;
  material.depthWrite = false;
  return material;
};
