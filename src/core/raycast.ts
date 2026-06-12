/**
 * Voxel raycasting: Amanatides–Woo DDA through the world grid plus the
 * baseplate ground-plane intersection used for building on empty floor.
 */

import type { RayHit } from "./types";
import { AIR, WORLD_SX, WORLD_SY, WORLD_SZ } from "./types";

const orig = new Float64Array(3);
const dir = new Float64Array(3);
const SIZE = Float64Array.of(WORLD_SX, WORLD_SY, WORLD_SZ);

/** March a ray through the voxel grid; returns the first non-air voxel hit or null. */
export const raycastVoxel = (
  getState: (x: number, y: number, z: number) => number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): RayHit | null => {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len === 0) return null;

  dx /= len;
  dy /= len;
  dz /= len;

  orig[0] = ox;
  orig[1] = oy;
  orig[2] = oz;
  dir[0] = dx;
  dir[1] = dy;
  dir[2] = dz;

  // ── clip to world slab ──────────────────────────────────────────────────────

  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterAxis = 0;
  for (let a = 0; a < 3; a++) {
    const d = dir[a]!;
    const o = orig[a]!;
    const s = SIZE[a]!;
    if (d === 0) {
      if (o < 0 || o > s) return null;
      continue;
    }
    let t1 = (0 - o) / d;
    let t2 = (s - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tEnter) {
      tEnter = t1;
      enterAxis = a;
    }
    if (t2 < tExit) tExit = t2;
  }
  if (tEnter > tExit || tExit < 0) return null;

  // ── entry cell ──────────────────────────────────────────────────────────────

  const t0 = Math.max(tEnter, 0) + 1e-7;
  if (t0 > maxDist) return null;

  let x = Math.floor(ox + dx * t0);
  let y = Math.floor(oy + dy * t0);
  let z = Math.floor(oz + dz * t0);
  if (x < 0 || y < 0 || z < 0 || x >= WORLD_SX || y >= WORLD_SY || z >= WORLD_SZ) return null;

  if (getState(x, y, z) !== AIR) {
    let axis: number;
    if (tEnter > 0) {
      axis = enterAxis;
    } else {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const az = Math.abs(dz);
      axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    }
    return { x, y, z, face: (axis << 1) | (dir[axis]! > 0 ? 1 : 0), ground: false };
  }

  // ── DDA march ───────────────────────────────────────────────────────────────

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  let tMaxX = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (x - ox) / dx : Infinity;
  let tMaxY = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (y - oy) / dy : Infinity;
  let tMaxZ = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (z - oz) / dz : Infinity;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  for (;;) {
    let t: number;
    let face: number;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      x += stepX;
      face = stepX > 0 ? 1 : 0;
    } else if (tMaxY <= tMaxZ) {
      t = tMaxY;
      tMaxY += tDeltaY;
      y += stepY;
      face = stepY > 0 ? 3 : 2;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      z += stepZ;
      face = stepZ > 0 ? 5 : 4;
    }

    if (t > maxDist) return null;
    if (x < 0 || y < 0 || z < 0 || x >= WORLD_SX || y >= WORLD_SY || z >= WORLD_SZ) return null;
    if (getState(x, y, z) !== AIR) return { x, y, z, face, ground: false };
  }
};

/** Intersect a downward ray with the y=0 baseplate; returns a ground RayHit or null. */
export const raycastGround = (
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): RayHit | null => {
  if (dy >= 0) return null;

  const t = -oy / dy;
  if (t <= 0) return null;

  const x = Math.floor(ox + dx * t);
  const z = Math.floor(oz + dz * t);
  if (x < 0 || x >= WORLD_SX || z < 0 || z >= WORLD_SZ) return null;

  return { x, y: -1, z, face: 2, ground: true };
};
