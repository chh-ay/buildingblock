/**
 * Shared cinematic-camera math: the framing orbit used by build replay, attract
 * mode, and the deterministic hero shot after boots and loads.
 */
import { Vector3 } from "three";
import { WORLD_SX, WORLD_SZ } from "../core/types";
import type { VoxelWorld } from "../core/world";
import type { CameraRig } from "../render/camera";

export interface OrbitCenter {
  x: number;
  y: number;
  z: number;
}

export interface OrbitFrame {
  center: OrbitCenter;
  radius: number;
}

export interface OrbitMath {
  /** Camera position on the framing orbit; writes into `out` and returns it. */
  orbitPoint(center: OrbitCenter, radius: number, angle: number, out: Vector3): Vector3;
  /** Scene-space orbit pivot + radius for the current build (offset-corrected). */
  orbitFrame(): OrbitFrame;
  /** Deterministic hero shot: frame the build from a fixed pleasant azimuth. */
  frameHero(): void;
}

export interface OrbitDeps {
  cameraRig: CameraRig;
  world: VoxelWorld;
  worldOffsetX: number;
  worldOffsetZ: number;
}

export const createOrbitMath = (deps: OrbitDeps): OrbitMath => {
  const { cameraRig, world } = deps;
  const scratch = new Vector3();

  /**
   * Camera position on an orbit that frames a bounding sphere of `radius` with
   * the same fov-derived margin CameraRig.frame uses — the whole build stays in
   * shot for the entire revolution.
   */
  const orbitPoint = (
    center: OrbitCenter,
    radius: number,
    angle: number,
    out: Vector3,
  ): Vector3 => {
    const halfFov = (cameraRig.camera.fov * Math.PI) / 360;
    const distance = Math.max(18, (radius / Math.tan(halfFov)) * 1.12);
    const elevation = 0.58; // ~33° above the horizon

    const horizontal = distance * Math.cos(elevation);
    out.set(
      center.x + Math.cos(angle) * horizontal,
      center.y + distance * Math.sin(elevation),
      center.z + Math.sin(angle) * horizontal,
    );
    return out;
  };

  const orbitFrame = (): OrbitFrame => {
    const bounds = world.contentBounds();
    if (!bounds) {
      return { center: { x: 0, y: 6, z: 0 }, radius: Math.max(WORLD_SX, WORLD_SZ) * 0.4 };
    }

    const { min, max } = bounds;
    return {
      center: {
        x: (min[0] + max[0]) / 2 - deps.worldOffsetX,
        y: (min[1] + max[1]) / 2,
        z: (min[2] + max[2]) / 2 - deps.worldOffsetZ,
      },
      radius: Math.max(8, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2),
    };
  };

  const frameHero = (): void => {
    const { center, radius } = orbitFrame();
    orbitPoint(center, radius, -0.65, scratch);

    cameraRig.controls.target.set(center.x, center.y, center.z);
    cameraRig.camera.position.copy(scratch);
    cameraRig.camera.lookAt(cameraRig.controls.target);
  };

  return { orbitPoint, orbitFrame, frameHero };
};
