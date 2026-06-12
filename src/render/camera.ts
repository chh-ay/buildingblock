/**
 * Perspective camera + orbit controls + voxel-space ray picking.
 * Scene space = voxel space shifted by (-WORLD_SX/2, 0, -WORLD_SZ/2); pickRay removes the shift.
 */
import { MOUSE, PerspectiveCamera, Raycaster, TOUCH, Vector2 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { WORLD_SX, WORLD_SY, WORLD_SZ } from "../core/types";
import type { Ray } from "../interact/api";

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Near plane tight enough that block-level close-ups don't clip.
    this.camera = new PerspectiveCamera(50, 1, 0.05, 2000);
    this.camera.position.set(34, 30, 52);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    // Time-based damping (update receives dt); higher factor = tighter stop.
    this.controls.dampingFactor = 0.15;
    this.controls.target.set(0, 3, 0);
    // Close enough to inspect a single block face-on.
    this.controls.minDistance = 0.6;
    // Zoom-out ceiling scales with the world so small plates can't become a speck.
    this.controls.maxDistance = Math.max(160, Math.max(WORLD_SX, WORLD_SZ) * 2.2);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    // Wheel dollies straight along the view axis (cursor-tracking zoom reads as an
    // arc); F re-pivots onto the hovered block when you want to dive somewhere.
    this.controls.zoomToCursor = false;
    // Pan slides along the ground plane instead of drifting skyward in screen space.
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  }

  /** Client coords → ray in voxel space. */
  pickRay(clientX: number, clientY: number): Ray {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    return {
      ox: o.x + WORLD_SX / 2,
      oy: o.y,
      oz: o.z + WORLD_SZ / 2,
      dx: d.x,
      dy: d.y,
      dz: d.z,
    };
  }

  /** Frame a voxel-space AABB (or the whole plate when null), keeping the current view direction. */
  frame(bounds: { min: [number, number, number]; max: [number, number, number] } | null): void {
    let cx = 0;
    let cy = 4;
    let cz = 0;
    let radius = Math.max(WORLD_SX, WORLD_SZ) * 0.42;

    if (bounds) {
      const { min, max } = bounds;
      cx = (min[0] + max[0]) / 2 - WORLD_SX / 2;
      cy = (min[1] + max[1]) / 2;
      cz = (min[2] + max[2]) / 2 - WORLD_SZ / 2;
      radius = Math.max(6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    }

    const dist = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.15;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() === 0) dir.set(0.5, 0.6, 0.8).normalize();

    // Rescue degenerate angles: an orbit that drifted to eye level (or below the
    // plate) reframes at a pleasant 3/4 elevation instead of a flat side view.
    if (dir.y < 0.25) {
      const horizontal = Math.max(1e-4, Math.hypot(dir.x, dir.z));
      const lift = 0.545; // sin ≈ 33° above the horizon
      const scale = Math.sqrt(1 - lift * lift) / horizontal;
      dir.set(dir.x * scale, lift, dir.z * scale);
    }

    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
  }

  /**
   * Re-pivot the orbit on a voxel-space point without changing the view
   * direction or distance (camera pans by the same delta as the target).
   */
  focusOn(x: number, y: number, z: number): void {
    const target = this.controls.target;
    const sx = x - WORLD_SX / 2;
    const sz = z - WORLD_SZ / 2;

    this.camera.position.x += sx - target.x;
    this.camera.position.y += y - target.y;
    this.camera.position.z += sz - target.z;
    target.set(sx, y, sz);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dtSeconds: number): void {
    this.controls.update(dtSeconds);
    // Keep the orbit pivot inside the build volume (+ a small margin) so panning
    // can never strand the camera in empty air past the world.
    const target = this.controls.target;
    const limitX = WORLD_SX / 2 + 8;
    const limitZ = WORLD_SZ / 2 + 8;
    const limitY = WORLD_SY + 12;
    const clampedX = target.x < -limitX ? -limitX : target.x > limitX ? limitX : target.x;
    const clampedY = target.y < 0 ? 0 : target.y > limitY ? limitY : target.y;
    const clampedZ = target.z < -limitZ ? -limitZ : target.z > limitZ ? limitZ : target.z;
    if (clampedX !== target.x || clampedY !== target.y || clampedZ !== target.z) {
      // Move the camera by the same correction so the view doesn't jerk at the edge.
      this.camera.position.x += clampedX - target.x;
      this.camera.position.y += clampedY - target.y;
      this.camera.position.z += clampedZ - target.z;
      target.set(clampedX, clampedY, clampedZ);
    }
  }
}
