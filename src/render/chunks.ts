/** Owns one Mesh per (bucket, chunk); applies mesher output buffers to BufferGeometries. */
import {
  BufferAttribute,
  BufferGeometry,
  type Frustum,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  Vector3,
} from "three";
import {
  BUCKET_GLASS,
  CHUNK_COUNT,
  CHUNK_SIZE,
  type ChunkGeometry,
  WORLD_CX,
  WORLD_CZ,
} from "../core/types";

const CHUNK_RADIUS = Math.sqrt(3) * (CHUNK_SIZE / 2) + 0.5;

/** sRGB transfer decode for one byte channel (exact EOTF, not the 2.2 approximation). */
const srgbByteToLinear = (byte: number): number => {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

export class ChunkRenderer {
  readonly group = new Group();
  private readonly columns: (Mesh | null)[][] = [];
  private readonly materials: Material[] = [];

  constructor(materials: Material[]) {
    for (const m of materials) this.addBucket(m);
  }

  /** Register a render bucket (custom material classes); returns its bucket id. */
  addBucket(material: Material): number {
    this.materials.push(material);
    this.columns.push(new Array<Mesh | null>(CHUNK_COUNT).fill(null));
    return this.materials.length - 1;
  }

  apply(ci: number, geo: ChunkGeometry): void {
    for (let bucket = 0; bucket < this.columns.length; bucket++) {
      const bucketGeo = bucket < geo.length ? geo[bucket] : null;
      const column = this.columns[bucket];
      const existing = column[ci];
      if (!bucketGeo || bucketGeo.vertexCount === 0) {
        if (existing) {
          existing.geometry.dispose();
          this.group.remove(existing);
          column[ci] = null;
        }
        continue;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(bucketGeo.position, 3));
      geometry.setAttribute("normal", new BufferAttribute(bucketGeo.normal, 4, true));
      geometry.setAttribute("color", new BufferAttribute(bucketGeo.color, 4, true));
      geometry.setAttribute("extra", new BufferAttribute(bucketGeo.extra, 4, true));
      geometry.setIndex(new BufferAttribute(bucketGeo.index, 1));
      geometry.boundingSphere = new Sphere(
        new Vector3(CHUNK_SIZE / 2, CHUNK_SIZE / 2, CHUNK_SIZE / 2),
        CHUNK_RADIUS,
      );
      if (existing) {
        const old = existing.geometry;
        existing.geometry = geometry;
        old.dispose();
      } else {
        const mesh = new Mesh(geometry, this.materials[bucket]);
        const cx = ci % WORLD_CX;
        const cz = ((ci / WORLD_CX) | 0) % WORLD_CZ;
        const cy = (ci / (WORLD_CX * WORLD_CZ)) | 0;
        mesh.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = bucket !== BUCKET_GLASS;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        column[ci] = mesh;
      }
    }
  }

  /** Live chunk-mesh totals and how many intersect the frustum (HUD). */
  counts(frustum: Frustum | null): { total: number; visible: number } {
    let total = 0;
    let visible = 0;
    for (const col of this.columns) {
      for (const m of col) {
        if (!m) continue;
        total++;
        if (!frustum || frustum.intersectsObject(m)) visible++;
      }
    }
    return { total, visible };
  }

  /**
   * Portable clone for glTF export: float normals + linear float colors (the live
   * 8-bit/normalized layout would force KHR_mesh_quantization), custom attrs dropped.
   */
  buildExportGroup(offsetX: number, offsetZ: number): Group {
    const root = new Group();
    root.position.set(offsetX, 0, offsetZ);
    for (let bucket = 0; bucket < this.columns.length; bucket++) {
      const material = new MeshStandardMaterial({
        vertexColors: true,
        roughness: bucket === BUCKET_GLASS ? 0.1 : 0.85,
        metalness: 0,
        transparent: bucket === BUCKET_GLASS,
        opacity: bucket === BUCKET_GLASS ? 0.45 : 1,
      });
      for (const mesh of this.columns[bucket]) {
        if (!mesh) continue;
        const source = mesh.geometry;
        const vertexCount = source.getAttribute("position").count;
        const normalBytes = source.getAttribute("normal").array as Int8Array;
        const colorBytes = source.getAttribute("color").array as Uint8Array;
        const floatNormal = new Float32Array(vertexCount * 3);
        const floatColor = new Float32Array(vertexCount * 3);
        for (let i = 0; i < vertexCount; i++) {
          for (let component = 0; component < 3; component++) {
            floatNormal[i * 3 + component] = normalBytes[i * 4 + component] / 127;
            floatColor[i * 3 + component] = srgbByteToLinear(colorBytes[i * 4 + component]);
          }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", source.getAttribute("position"));
        geometry.setAttribute("normal", new BufferAttribute(floatNormal, 3));
        geometry.setAttribute("color", new BufferAttribute(floatColor, 3));
        geometry.setIndex(source.getIndex());
        const clone = new Mesh(geometry, material);
        clone.position.copy(mesh.position);
        root.add(clone);
      }
    }
    return root;
  }
}
