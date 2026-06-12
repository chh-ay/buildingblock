/**
 * Attract mode: the first-run diorama that spins under the frosted size picker,
 * cycling one stylized day every 150 seconds.
 */
import { Vector3 } from "three";
import type { CameraRig } from "../render/camera";
import type { OrbitMath } from "./orbit";
import type { SkyController } from "./sky";

export interface Attract {
  start(): void;
  stop(): void;
  active(): boolean;
  /** Per-frame tick from the render loop; no-op while inactive. */
  step(now: number): void;
}

export const createAttract = (
  cameraRig: CameraRig,
  orbit: OrbitMath,
  sky: SkyController,
): Attract => {
  const scratch = new Vector3();
  let running = false;
  let skyAppliedAt = 0;

  const step = (now: number): void => {
    if (!running) return;

    const { center, radius } = orbit.orbitFrame();
    orbit.orbitPoint(center, radius, now * 0.00018, scratch);
    cameraRig.controls.target.set(center.x, center.y, center.z);
    cameraRig.camera.position.copy(scratch);
    cameraRig.camera.lookAt(cameraRig.controls.target);

    if (now - skyAppliedAt >= 250) {
      skyAppliedAt = now;
      // One stylized day every 150 seconds, starting at morning so the first minute stays bright.
      sky.applySky(sky.skyAtDayFrac((0.32 + now / 150_000) % 1));
    }
  };

  return {
    start: () => {
      running = true;
    },
    stop: () => {
      running = false;
    },
    active: () => running,
    step,
  };
};
