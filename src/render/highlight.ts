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
import {
  FACE_NORMAL,
  type RayHit,
  SHAPE_CORNER_NXNZ,
  SHAPE_CORNER_NXPZ,
  SHAPE_CORNER_PXNZ,
  SHAPE_CORNER_PXPZ,
  SHAPE_COUNT,
  SHAPE_CUBE,
  SHAPE_INNER_NXNZ,
  SHAPE_INNER_NXPZ,
  SHAPE_INNER_PXNZ,
  SHAPE_INNER_PXPZ,
  SHAPE_RAMP_NX,
  SHAPE_RAMP_NZ,
  SHAPE_RAMP_PX,
  SHAPE_RAMP_PZ,
  SHAPE_SLAB_BOTTOM,
  SHAPE_SLAB_TOP,
  SHAPE_VSLAB_NX,
  SHAPE_VSLAB_NZ,
  SHAPE_VSLAB_PX,
  SHAPE_VSLAB_PZ,
} from "../core/types";
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

// ── preview shape geometry ────────────────────────────────────────────────────

/**
 * Triangle-list geometry from unit-cell [0,1]³ coords, re-centered on the origin.
 * Triangles wind CCW seen from outside so front-face culling keeps every face visible.
 * WebGPU pipelines bind normal/uv for mesh materials and position-only geometry
 * breaks them, so a uv attribute and computed normals always ride along.
 */
const buildTriangleGeometry = (unitTriangles: readonly number[]): BufferGeometry => {
  const positions = new Float32Array(unitTriangles.length);
  for (let i = 0; i < unitTriangles.length; i++) positions[i] = unitTriangles[i] - 0.5;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.computeVertexNormals();

  return geometry;
};

/** Wedge spanning the unit cell, top surface rising toward +x (SHAPE_RAMP_PX). */
const buildRampGeometry = (): BufferGeometry =>
  buildTriangleGeometry([
    // bottom (y = 0)
    0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    // back wall (x = 1)
    1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1,
    // slope (from -x bottom edge to +x top edge)
    0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0,
    // side (z = 0)
    0, 0, 0, 1, 1, 0, 1, 0, 0,
    // side (z = 1)
    0, 0, 1, 1, 0, 1, 1, 1, 1,
  ]);

/** Outer corner wedge rising toward +x+z (SHAPE_CORNER_PXPZ): top surface y = min(x, z). */
const buildCornerGeometry = (): BufferGeometry =>
  buildTriangleGeometry([
    // bottom (y = 0)
    0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    // +x wall triangle (zero height on the -x/-z walls, so no faces there)
    1, 0, 0, 1, 1, 1, 1, 0, 1,
    // +z wall triangle
    0, 0, 1, 1, 0, 1, 1, 1, 1,
    // top slope, z <= x half
    0, 0, 0, 1, 1, 1, 1, 0, 0,
    // top slope, x <= z half
    0, 0, 0, 0, 0, 1, 1, 1, 1,
  ]);

/** Inner corner closing toward +x+z (SHAPE_INNER_PXPZ): top surface y = max(x, z). */
const buildInnerGeometry = (): BufferGeometry =>
  buildTriangleGeometry([
    // bottom (y = 0)
    0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    // +x wall (full quad)
    1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1,
    // +z wall (full quad)
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1,
    // -x wall triangle
    0, 0, 0, 0, 0, 1, 0, 1, 1,
    // -z wall triangle
    0, 0, 0, 1, 1, 0, 1, 0, 0,
    // top slope, x >= z half
    0, 0, 0, 1, 1, 1, 1, 1, 0,
    // top slope, z >= x half
    0, 0, 0, 0, 1, 1, 1, 1, 1,
  ]);

/** Preview geometry per shape id, all centered on the cell. */
const buildShapeGeometries = (): BufferGeometry[] => {
  const shapes: BufferGeometry[] = new Array(SHAPE_COUNT);

  shapes[SHAPE_CUBE] = new BoxGeometry(1, 1, 1);
  shapes[SHAPE_SLAB_BOTTOM] = new BoxGeometry(1, 0.5, 1).translate(0, -0.25, 0);
  shapes[SHAPE_SLAB_TOP] = new BoxGeometry(1, 0.5, 1).translate(0, 0.25, 0);

  const rampPx = buildRampGeometry();
  shapes[SHAPE_RAMP_PX] = rampPx;
  shapes[SHAPE_RAMP_NX] = rampPx.clone().rotateY(Math.PI);
  shapes[SHAPE_RAMP_PZ] = rampPx.clone().rotateY(-Math.PI / 2);
  shapes[SHAPE_RAMP_NZ] = rampPx.clone().rotateY(Math.PI / 2);

  // Vertical half slabs hug the named cell wall.
  shapes[SHAPE_VSLAB_PX] = new BoxGeometry(0.5, 1, 1).translate(0.25, 0, 0);
  shapes[SHAPE_VSLAB_NX] = new BoxGeometry(0.5, 1, 1).translate(-0.25, 0, 0);
  shapes[SHAPE_VSLAB_PZ] = new BoxGeometry(1, 1, 0.5).translate(0, 0, 0.25);
  shapes[SHAPE_VSLAB_NZ] = new BoxGeometry(1, 1, 0.5).translate(0, 0, -0.25);

  // Diagonal families spin like the ramps: -90° → NXPZ, 180° → NXNZ, +90° → PXNZ
  // (rotateY maps the +x+z corner accordingly; rotations keep windings outward).
  const cornerPxPz = buildCornerGeometry();
  shapes[SHAPE_CORNER_PXPZ] = cornerPxPz;
  shapes[SHAPE_CORNER_NXPZ] = cornerPxPz.clone().rotateY(-Math.PI / 2);
  shapes[SHAPE_CORNER_NXNZ] = cornerPxPz.clone().rotateY(Math.PI);
  shapes[SHAPE_CORNER_PXNZ] = cornerPxPz.clone().rotateY(Math.PI / 2);

  const innerPxPz = buildInnerGeometry();
  shapes[SHAPE_INNER_PXPZ] = innerPxPz;
  shapes[SHAPE_INNER_NXPZ] = innerPxPz.clone().rotateY(-Math.PI / 2);
  shapes[SHAPE_INNER_NXNZ] = innerPxPz.clone().rotateY(Math.PI);
  shapes[SHAPE_INNER_PXNZ] = innerPxPz.clone().rotateY(Math.PI / 2);

  return shapes;
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
