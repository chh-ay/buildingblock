/** Hover outline + face highlight + ghost preview instances, all in voxel space. */
import {
  BoxGeometry,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";
import { FACE_NORMAL, type RayHit } from "../core/types";

const ACCENT = 0x3fa7c4;
const MAX_GHOSTS = 1 << 16;

/** Plane rotation per face id (PlaneGeometry faces +z by default). */
const FACE_EULER: readonly [number, number, number][] = [
  [0, Math.PI / 2, 0],
  [0, -Math.PI / 2, 0],
  [-Math.PI / 2, 0, 0],
  [Math.PI / 2, 0, 0],
  [0, 0, 0],
  [0, Math.PI, 0],
];

export class Highlighter {
  readonly group = new Group();
  private readonly box: LineSegments;
  private readonly face: Mesh;
  private ghosts: InstancedMesh;
  private capacity = 4096;
  private readonly mat4 = new Matrix4();

  constructor() {
    this.box = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.002, 1.002, 1.002)),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    this.face = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.box.visible = false;
    this.face.visible = false;
    this.ghosts = this.makeGhostMesh(this.capacity);
    this.group.add(this.box, this.face, this.ghosts);
  }

  setHover(hit: RayHit | null): void {
    if (!hit) {
      this.box.visible = false;
      this.face.visible = false;
      return;
    }
    const n = hit.face * 3;
    this.box.visible = !hit.ground;
    if (!hit.ground) this.box.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.face.visible = true;
    this.face.position.set(
      hit.x + 0.5 + FACE_NORMAL[n] * 0.503,
      hit.ground ? 0.003 : hit.y + 0.5 + FACE_NORMAL[n + 1] * 0.503,
      hit.z + 0.5 + FACE_NORMAL[n + 2] * 0.503,
    );
    const e = FACE_EULER[hit.face];
    this.face.rotation.set(e[0], e[1], e[2]);
  }

  setGhosts(cells: Int32Array | null, count: number): void {
    if (!cells || count <= 0) {
      this.ghosts.count = 0;
      return;
    }
    const n = Math.min(count, MAX_GHOSTS);
    if (n > this.capacity) {
      let cap = this.capacity;
      while (cap < n) cap <<= 1;
      this.group.remove(this.ghosts);
      this.ghosts.dispose();
      this.capacity = cap;
      this.ghosts = this.makeGhostMesh(cap);
      this.group.add(this.ghosts);
    }
    for (let i = 0; i < n; i++) {
      this.mat4.makeTranslation(cells[i * 3] + 0.5, cells[i * 3 + 1] + 0.5, cells[i * 3 + 2] + 0.5);
      this.ghosts.setMatrixAt(i, this.mat4);
    }
    this.ghosts.count = n;
    this.ghosts.instanceMatrix.needsUpdate = true;
  }

  private makeGhostMesh(cap: number): InstancedMesh {
    const m = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.32, depthWrite: false }),
      cap,
    );
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }
}
