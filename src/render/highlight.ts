/**
 * Tool-aware hover feedback + ghost preview instances, all in voxel space.
 *
 * The old model drew an accent-colored quad over the hovered face for every
 * tool, which visually "repainted" whatever block you pointed at and put the
 * emphasis on the wrong cell for placement. Now each tool gets honest feedback:
 * - place/box: a translucent preview of the actual block (color + shape) in the
 *   cell it would occupy; nothing is drawn over existing blocks.
 * - erase: a red wireframe around the block that would be removed.
 * - paint: a quad in the new color on the hovered face (a true paint preview)
 *   plus a neutral wireframe.
 * - pick: a neutral wireframe.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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
import type { ToolId } from "../state";

const ERASE_TINT = 0xe0524d;
const NEUTRAL = 0xffffff;
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

/** Wedge spanning the unit cell, top surface rising toward +x (SHAPE_RAMP_PX). */
const buildRampGeometry = (): BufferGeometry => {
  // Triangles: bottom (2), +x back face (2), slope (2), two side triangles.
  // prettier-ignore
  const positions = new Float32Array([
    // bottom (y = -0.5)
    -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    0.5,
    // back (x = +0.5)
    0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
    // slope (from -x bottom edge to +x top edge)
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    -0.5,
    // side (z = -0.5)
    -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
    // side (z = +0.5)
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
  ]);
  const wedge = new BufferGeometry();
  wedge.setAttribute("position", new BufferAttribute(positions, 3));
  // WebGPU pipelines bind normal/uv for mesh materials; position-only geometry breaks them.
  wedge.setAttribute("uv", new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  wedge.computeVertexNormals();
  return wedge;
};

/** Preview geometry per shape id, all centered on the cell. */
const buildShapeGeometries = (): BufferGeometry[] => {
  const cube = new BoxGeometry(1, 1, 1);
  const slabBottom = new BoxGeometry(1, 0.5, 1).translate(0, -0.25, 0);
  const slabTop = new BoxGeometry(1, 0.5, 1).translate(0, 0.25, 0);
  const rampPx = buildRampGeometry();
  return [
    cube,
    slabBottom,
    slabTop,
    rampPx,
    rampPx.clone().rotateY(Math.PI),
    rampPx.clone().rotateY(-Math.PI / 2),
    rampPx.clone().rotateY(Math.PI / 2),
  ];
};

export class Highlighter {
  readonly group = new Group();
  private readonly box: LineSegments;
  private readonly boxMaterial: LineBasicMaterial;
  private readonly face: Mesh;
  private readonly faceMaterial: MeshBasicMaterial;
  private readonly preview: Mesh;
  private readonly previewMaterial: MeshBasicMaterial;
  private readonly shapes: BufferGeometry[];
  private ghosts: InstancedMesh;
  private ghostMaterial: MeshBasicMaterial;
  private capacity = 4096;
  private readonly mat4 = new Matrix4();

  constructor() {
    this.boxMaterial = new LineBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.4 });
    this.box = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.002, 1.002, 1.002)),
      this.boxMaterial,
    );
    this.faceMaterial = new MeshBasicMaterial({
      color: NEUTRAL,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: DoubleSide,
    });
    this.face = new Mesh(new PlaneGeometry(1, 1), this.faceMaterial);
    this.shapes = buildShapeGeometries();
    this.previewMaterial = new MeshBasicMaterial({
      color: NEUTRAL,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.preview = new Mesh(this.shapes[0], this.previewMaterial);
    this.preview.scale.setScalar(0.996);
    this.box.visible = false;
    this.face.visible = false;
    this.preview.visible = false;
    this.ghostMaterial = new MeshBasicMaterial({
      color: NEUTRAL,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.ghosts = this.makeGhostMesh(this.capacity);
    this.group.add(this.box, this.face, this.preview, this.ghosts);
  }

  /**
   * Tool-aware hover: `rgb`/`shape` describe the block that WOULD be placed,
   * `canPlace` whether the adjacent cell accepts it (in bounds and air).
   */
  setHover(hit: RayHit | null, tool: ToolId, rgb: number, shape: number, canPlace: boolean): void {
    this.box.visible = false;
    this.face.visible = false;
    this.preview.visible = false;
    if (!hit) return;

    if (tool === "place" || tool === "box") {
      if (!canPlace) return;
      const n = hit.face * 3;
      const px = hit.ground ? hit.x : hit.x + FACE_NORMAL[n];
      const py = hit.ground ? 0 : hit.y + FACE_NORMAL[n + 1];
      const pz = hit.ground ? hit.z : hit.z + FACE_NORMAL[n + 2];
      this.preview.geometry = this.shapes[shape] ?? this.shapes[0];
      this.previewMaterial.color.setHex(rgb);
      this.preview.position.set(px + 0.5, py + 0.5, pz + 0.5);
      this.preview.visible = true;
      return;
    }

    if (hit.ground) return; // erase/paint/pick act on blocks only
    this.box.visible = true;
    this.box.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.boxMaterial.color.setHex(tool === "erase" ? ERASE_TINT : NEUTRAL);
    this.boxMaterial.opacity = tool === "erase" ? 0.85 : 0.4;

    if (tool === "paint") {
      const n = hit.face * 3;
      this.faceMaterial.color.setHex(rgb);
      this.face.position.set(
        hit.x + 0.5 + FACE_NORMAL[n] * 0.503,
        hit.y + 0.5 + FACE_NORMAL[n + 1] * 0.503,
        hit.z + 0.5 + FACE_NORMAL[n + 2] * 0.503,
      );
      const e = FACE_EULER[hit.face];
      this.face.rotation.set(e[0], e[1], e[2]);
      this.face.visible = true;
    }
  }

  /** Ghost rect preview tinted to match the gesture (paint color, red for erase). */
  setGhosts(cells: Int32Array | null, count: number, rgb: number): void {
    if (!cells || count <= 0) {
      this.ghosts.count = 0;
      return;
    }
    this.ghostMaterial.color.setHex(rgb);
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
    const m = new InstancedMesh(new BoxGeometry(1, 1, 1), this.ghostMaterial, cap);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }
}
