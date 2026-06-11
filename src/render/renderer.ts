/**
 * Renderer + scene + lighting boot. Backend policy:
 * - "webgl" preference (or ?gl) forces the WebGL2 backend.
 * - "auto" uses WebGPU but avoids software adapters (SwiftShader/llvmpipe) where real
 *   GL drivers are faster, falling back to WebGL2.
 * - "webgpu" takes WebGPU whenever the browser offers any adapter.
 * The canvas itself is not multisampled — the post pipeline owns MSAA, so we never pay
 * for two resolves per frame.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  Scene,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PMREMGenerator, WebGPURenderer } from "three/webgpu";
import { WORLD_SX, WORLD_SZ } from "../core/types";
import type { RendererPreference } from "../state";

/** Stylized sky state shared by the lights and the background (computed in main). */
export interface SkyState {
  azimuthDeg: number;
  elevationDeg: number;
  /** Active body: false = sun, true = moon (cool light, crisp small disc). */
  moon: boolean;
  /** 0 night … 1 full day; drives fill light, ambience, and palettes. */
  dayness: number;
}

export interface SceneLights {
  /** Re-render the on-demand shadow map after world edits. */
  invalidate(): void;
  setShadowsEnabled(enabled: boolean): void;
  setShadowResolution(size: number): void;
  /** Position + grade the celestial light and re-render the shadow map. */
  setCelestial(sky: SkyState): void;
}

export interface RenderCore {
  renderer: WebGPURenderer;
  scene: Scene;
  lights: SceneLights;
  /** Backend + adapter description for the perf HUD. */
  backend: string;
}

interface AdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

/** Peek at the WebGPU adapter before committing to a backend. */
const describeWebGpuAdapter = async (): Promise<{ text: string; software: boolean } | null> => {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return null;
    const adapter = (await gpu.requestAdapter()) as { info?: AdapterInfoLike } | null;
    if (!adapter) return null;
    const info = adapter.info ?? {};
    const text = [info.vendor, info.architecture, info.description]
      .filter((part): part is string => !!part)
      .join(" ");
    const software = /swiftshader|llvmpipe|lavapipe|software|cpu/i.test(
      `${text} ${info.device ?? ""}`,
    );
    return { text: text || "unknown adapter", software };
  } catch {
    return null;
  }
};

/** Adapter string for the active WebGL fallback context, when reachable. */
const describeWebGlContext = (renderer: WebGPURenderer): string => {
  const backend = renderer.backend as { gl?: WebGL2RenderingContext };
  const gl = backend.gl;
  if (!gl) return "";
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) return "";
  return String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "");
};

export const createRenderCore = async (
  canvas: HTMLCanvasElement,
  shadowResolution: number,
  preference: RendererPreference,
): Promise<RenderCore> => {
  let forceWebGL = preference === "webgl" || new URLSearchParams(window.location.search).has("gl");
  let adapterText = "";
  if (!forceWebGL) {
    const adapter = await describeWebGpuAdapter();
    if (!adapter) {
      forceWebGL = true;
    } else if (adapter.software && preference !== "webgpu") {
      forceWebGL = true; // a software WebGPU adapter is slower than the real GL driver
    } else {
      adapterText = adapter.text;
    }
  }

  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();

  // Shadows are render-on-demand: the world is static between edits, so the map
  // re-renders only when lights.invalidate() is called (per-light needsUpdate).
  const sun = new DirectionalLight(0xfff1de, 2.4);
  const sunDistance = Math.max(WORLD_SX, WORLD_SZ) * 1.4;
  const sunWarmLow = new Color(0xffc488);
  const sunWarmHigh = new Color(0xfff1de);
  const moonCool = new Color(0xbfd0ff);
  const fillNight = new Color(0x2a3450);
  const fillDay = new Color(0xbdd2e8);
  const setCelestial = (sky: SkyState): void => {
    const azimuth = (sky.azimuthDeg * Math.PI) / 180;
    const elevation = (sky.elevationDeg * Math.PI) / 180;
    sun.position.set(
      Math.cos(elevation) * Math.sin(azimuth) * sunDistance,
      Math.sin(elevation) * sunDistance,
      Math.cos(elevation) * Math.cos(azimuth) * sunDistance,
    );
    if (sky.moon) {
      sun.color.copy(moonCool);
      sun.intensity = 0.55;
    } else {
      const warmth = Math.min(1, Math.max(0, (sky.elevationDeg - 10) / 45));
      sun.color.lerpColors(sunWarmLow, sunWarmHigh, warmth);
      sun.intensity = 0.9 + 1.5 * sky.dayness;
    }
    skyFill.color.lerpColors(fillNight, fillDay, sky.dayness);
    skyFill.intensity = 0.18 + 0.47 * sky.dayness;
    scene.environmentIntensity = 0.1 + 0.25 * sky.dayness;
    sun.shadow.needsUpdate = true;
  };
  sun.castShadow = true;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  // Span covers the world footprint from any sun angle (diagonal at low elevations).
  const shadowSpan = Math.max(WORLD_SX, WORLD_SZ) * 1.05;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = sunDistance * 2.2;
  sun.shadow.mapSize.set(shadowResolution, shadowResolution);
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  const skyFill = new HemisphereLight(0xbdd2e8, 0x3a352f, 0.65);
  scene.add(skyFill);
  setCelestial({ azimuthDeg: 40, elevationDeg: 55, moon: false, dayness: 1 });

  // Soft studio reflections so gloss blocks read as glossy without an HDR download.
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const lights: SceneLights = {
    invalidate: () => {
      sun.shadow.needsUpdate = true;
    },
    setShadowsEnabled: (enabled) => {
      if (sun.castShadow === enabled) return;
      sun.castShadow = enabled;
      sun.shadow.needsUpdate = true;
    },
    setShadowResolution: (size) => {
      if (sun.shadow.mapSize.x === size) return;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.needsUpdate = true;
    },
    setCelestial,
  };

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const detail = isWebGPU ? adapterText : describeWebGlContext(renderer);
  const backend = `${isWebGPU ? "WebGPU" : "WebGL2"}${detail ? ` · ${detail}` : ""}`;
  return { renderer, scene, lights, backend };
};
