/**
 * Perspective camera + orbit controls + voxel-space ray picking.
 * Scene space = voxel space shifted by (-WORLD_SX/2, 0, -WORLD_SZ/2); pickRay removes the shift.
 */
import { MOUSE, PerspectiveCamera, Raycaster, TOUCH, Vector2 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { WORLD_SX, WORLD_SZ } from "../core/types";
import type { Ray } from "../interact/api";

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.camera = new PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(34, 30, 52);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 3, 0);
    this.controls.minDistance = 4;
    this.controls.maxDistance = 700;
    this.controls.maxPolarAngle = Math.PI * 0.495;
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
    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(): void {
    this.controls.update();
  }
}
