import {
  BOUNDARY,
  CHUNK_BITS,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  PAD_VOLUME,
  pIndex,
  vIndex,
  WORLD_CX,
  WORLD_CZ,
} from "./types";
import type { VoxelWorld } from "./world";

const scratch = new Uint16Array(CHUNK_VOLUME);

/** Fill a PAD³ array with resolved stateIds for chunk `ci` plus a one-voxel neighbor shell. */
export const buildPadded = (world: VoxelWorld, ci: number, out?: Uint16Array): Uint16Array => {
  const p = out ?? new Uint16Array(PAD_VOLUME);
  const cx = ci % WORLD_CX;
  const cz = ((ci / WORLD_CX) | 0) % WORLD_CZ;
  const cy = (ci / (WORLD_CX * WORLD_CZ)) | 0;
  const ox = cx << CHUNK_BITS;
  const oy = cy << CHUNK_BITS;
  const oz = cz << CHUNK_BITS;
  const n = CHUNK_SIZE;
  const chunk = world.chunks[ci];
  if (chunk) {
    chunk.readStates(scratch);
    for (let y = 0; y < n; y++) {
      for (let z = 0; z < n; z++) {
        const src = vIndex(0, y, z);
        p.set(scratch.subarray(src, src + n), pIndex(0, y, z));
      }
    }
  } else {
    for (let y = 0; y < n; y++) {
      for (let z = 0; z < n; z++) {
        const dst = pIndex(0, y, z);
        p.fill(0, dst, dst + n);
      }
    }
  }
  for (let ly = -1; ly <= n; ly++) {
    const wy = oy + ly;
    const below = wy < 0;
    const yShell = ly === -1 || ly === n;
    for (let lz = -1; lz <= n; lz++) {
      const wz = oz + lz;
      if (yShell || lz === -1 || lz === n) {
        for (let lx = -1; lx <= n; lx++) {
          p[pIndex(lx, ly, lz)] = below ? BOUNDARY : world.get(ox + lx, wy, wz);
        }
      } else {
        p[pIndex(-1, ly, lz)] = below ? BOUNDARY : world.get(ox - 1, wy, wz);
        p[pIndex(n, ly, lz)] = below ? BOUNDARY : world.get(ox + n, wy, wz);
      }
    }
  }
  return p;
};
