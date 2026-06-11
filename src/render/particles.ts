/**
 * Voxel juice FX in grid space: confetti burst on erase, expanding edge flash on place.
 * One InstancedMesh for all particles + a small pooled set of LineSegments for flashes;
 * zero allocation per burst()/flash()/update().
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
} from "three";

export interface VoxelFx {
  /** Root to add to the world group; positions passed in voxel-grid coordinates. */
  readonly object: Object3D;
  /** Confetti burst at a cell (erase/break). rgb = 0xRRGGBB of the destroyed voxel. */
  burst(x: number, y: number, z: number, rgb: number, count?: number): void;
  /** Snap flash on placement: brief expanding edge pulse around the cell. */
  flash(x: number, y: number, z: number, rgb: number): void;
  /** Advance simulation; dtSeconds clamped internally to [0, 0.1]. O(alive), zero work when idle. */
  update(dtSeconds: number): void;
  /** True when anything is animating (host can skip render-on-demand wakeups otherwise). */
  active(): boolean;
  dispose(): void;
}

const PARTICLE_CAP = 192;
const FLASH_CAP = 8;
const FLASH_SECONDS = 0.14;
const GRAVITY = -14;
const WHITE = new Color(1, 1, 1);

export const createVoxelFx = (): VoxelFx => {
  const root = new Group();

  // --- particles: parallel arrays, compact [0, alive) layout with swap-remove ---
  const posX = new Float32Array(PARTICLE_CAP);
  const posY = new Float32Array(PARTICLE_CAP);
  const posZ = new Float32Array(PARTICLE_CAP);
  const velX = new Float32Array(PARTICLE_CAP);
  const velY = new Float32Array(PARTICLE_CAP);
  const velZ = new Float32Array(PARTICLE_CAP);
  const ttl = new Float32Array(PARTICLE_CAP);
  const age = new Float32Array(PARTICLE_CAP);
  const size = new Float32Array(PARTICLE_CAP);
  let aliveParticles = 0;

  const particleGeometry = new BoxGeometry(0.16, 0.16, 0.16);
  const particleMaterial = new MeshBasicMaterial();
  const mesh = new InstancedMesh(particleGeometry, particleMaterial, PARTICLE_CAP);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const instanceColor = new InstancedBufferAttribute(new Float32Array(PARTICLE_CAP * 3), 3);
  instanceColor.setUsage(DynamicDrawUsage);
  mesh.instanceColor = instanceColor;
  const colorArray = instanceColor.array as Float32Array;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.visible = false;
  root.add(mesh);

  const scratchMatrix = new Matrix4();
  const scratchColor = new Color();

  /** Move particle from slot `from` to slot `to` (death compaction). */
  const copySlot = (from: number, to: number): void => {
    posX[to] = posX[from];
    posY[to] = posY[from];
    posZ[to] = posZ[from];
    velX[to] = velX[from];
    velY[to] = velY[from];
    velZ[to] = velZ[from];
    ttl[to] = ttl[from];
    age[to] = age[from];
    size[to] = size[from];
    colorArray[to * 3] = colorArray[from * 3];
    colorArray[to * 3 + 1] = colorArray[from * 3 + 1];
    colorArray[to * 3 + 2] = colorArray[from * 3 + 2];
  };

  // --- flash pool: shared edges geometry, per-line material for color/opacity ---
  const edgesGeometry = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  const flashMaterials: LineBasicMaterial[] = [];
  const flashLines: LineSegments[] = [];
  const flashAge = new Float32Array(FLASH_CAP).fill(FLASH_SECONDS); // >= duration -> free
  let aliveFlashes = 0;
  for (let i = 0; i < FLASH_CAP; i++) {
    const material = new LineBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const line = new LineSegments(edgesGeometry, material);
    line.frustumCulled = false;
    line.visible = false;
    flashMaterials.push(material);
    flashLines.push(line);
    root.add(line);
  }

  const burst = (x: number, y: number, z: number, rgb: number, count = 8): void => {
    scratchColor.setHex(rgb);
    const centerX = x + 0.5;
    const centerY = y + 0.5;
    const centerZ = z + 0.5;
    let spawned = 0;
    for (let n = 0; n < count && aliveParticles < PARTICLE_CAP; n++) {
      const i = aliveParticles++;
      posX[i] = centerX;
      posY[i] = centerY;
      posZ[i] = centerZ;
      velX[i] = (Math.random() * 2 - 1) * 2.2;
      velZ[i] = (Math.random() * 2 - 1) * 2.2;
      velY[i] = 1.5 + Math.random() * 2.5;
      ttl[i] = 0.35 + Math.random() * 0.2;
      age[i] = 0;
      size[i] = 0.7 + Math.random() * 0.6;
      // Per-particle ±10% brightness jitter on the destroyed voxel's color.
      const c = i * 3;
      colorArray[c] = Math.min(scratchColor.r * (0.9 + Math.random() * 0.2), 1);
      colorArray[c + 1] = Math.min(scratchColor.g * (0.9 + Math.random() * 0.2), 1);
      colorArray[c + 2] = Math.min(scratchColor.b * (0.9 + Math.random() * 0.2), 1);
      const s = size[i];
      scratchMatrix.makeScale(s, s, s).setPosition(centerX, centerY, centerZ);
      mesh.setMatrixAt(i, scratchMatrix);
      spawned++;
    }
    if (spawned > 0) {
      mesh.count = aliveParticles;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      instanceColor.needsUpdate = true;
    }
  };

  const flash = (x: number, y: number, z: number, rgb: number): void => {
    // First free slot, else steal the flash closest to death.
    let slot = -1;
    let oldestAge = -1;
    for (let i = 0; i < FLASH_CAP; i++) {
      if (flashAge[i] >= FLASH_SECONDS) {
        slot = i;
        break;
      }
      if (flashAge[i] > oldestAge) {
        oldestAge = flashAge[i];
        slot = i;
      }
    }
    if (flashAge[slot] >= FLASH_SECONDS) aliveFlashes++;
    flashAge[slot] = 0;
    const line = flashLines[slot];
    line.position.set(x + 0.5, y + 0.5, z + 0.5);
    line.scale.setScalar(1.02);
    line.visible = true;
    const material = flashMaterials[slot];
    material.opacity = 0.9;
    material.color.setHex(rgb).lerp(WHITE, 0.65);
  };

  const update = (dtSeconds: number): void => {
    if (aliveParticles === 0 && aliveFlashes === 0) return;
    const dt = dtSeconds < 0 ? 0 : dtSeconds > 0.1 ? 0.1 : dtSeconds;

    if (aliveParticles > 0) {
      let i = 0;
      while (i < aliveParticles) {
        age[i] += dt;
        if (age[i] >= ttl[i]) {
          aliveParticles--;
          if (i !== aliveParticles) copySlot(aliveParticles, i);
          continue;
        }
        velY[i] += GRAVITY * dt;
        posX[i] += velX[i] * dt;
        posY[i] += velY[i] * dt;
        posZ[i] += velZ[i] * dt;
        i++;
      }
      for (let k = 0; k < aliveParticles; k++) {
        const t = age[k] / ttl[k];
        const s = size[k] * (1 - t * t * t); // eases to 0 near death
        scratchMatrix.makeScale(s, s, s).setPosition(posX[k], posY[k], posZ[k]);
        mesh.setMatrixAt(k, scratchMatrix);
      }
      mesh.count = aliveParticles;
      mesh.visible = aliveParticles > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (aliveFlashes > 0) {
      for (let i = 0; i < FLASH_CAP; i++) {
        if (flashAge[i] >= FLASH_SECONDS) continue;
        flashAge[i] += dt;
        if (flashAge[i] >= FLASH_SECONDS) {
          flashLines[i].visible = false;
          aliveFlashes--;
          continue;
        }
        const t = flashAge[i] / FLASH_SECONDS;
        flashLines[i].scale.setScalar(1.02 + 0.26 * t);
        flashMaterials[i].opacity = 0.9 * (1 - t);
      }
    }
  };

  return {
    object: root,
    burst,
    flash,
    update,
    active: () => aliveParticles > 0 || aliveFlashes > 0,
    dispose: () => {
      particleGeometry.dispose();
      particleMaterial.dispose();
      mesh.dispose();
      edgesGeometry.dispose();
      for (const material of flashMaterials) material.dispose();
    },
  };
};
