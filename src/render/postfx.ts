/**
 * Render pipeline: one MSAA scene pass feeding the canvas (which itself is not
 * multisampled — exactly one resolve per frame). Bloom toggles by swapping the
 * pipeline output node; everything always renders through the pipeline so AA
 * stays consistent.
 */
import type { PerspectiveCamera, Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";
import { type Node, RenderPipeline, type WebGPURenderer } from "three/webgpu";

export class PostPipeline {
  private readonly pipeline: RenderPipeline;
  private readonly plainOutput: Node;
  private readonly bloomOutput: Node;

  constructor(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
    this.pipeline = new RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 4 });
    const sceneColor = scenePass.getTextureNode("output");
    // Bloom runs in linear working space; the pipeline appends tonemap + sRGB itself.
    this.plainOutput = sceneColor;
    this.bloomOutput = sceneColor.add(bloom(sceneColor, 0.55, 0.35, 0.85));
    this.pipeline.outputNode = this.bloomOutput;
  }

  setBloom(enabled: boolean): void {
    const next = enabled ? this.bloomOutput : this.plainOutput;
    if (this.pipeline.outputNode === next) return;
    this.pipeline.outputNode = next;
    this.pipeline.needsUpdate = true;
  }

  render(): void {
    this.pipeline.render();
  }
}
