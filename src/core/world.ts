import { Chunk } from "./chunk";
import type { WorldSnapshot } from "./types";
import {
  AIR,
  CHUNK_BITS,
  CHUNK_COUNT,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  cIndex,
  inWorld,
  packState,
  stateUniqueKey,
  vIndex,
  WORLD_CX,
  WORLD_CY,
  WORLD_CZ,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
} from "./types";

const offsX = new Int8Array(2);
const offsY = new Int8Array(2);
const offsZ = new Int8Array(2);

/** Sparse chunked voxel world with interned block states and dirty-chunk notification. */
export class VoxelWorld {
  readonly chunks: (Chunk | null)[] = new Array<Chunk | null>(CHUNK_COUNT).fill(null);
  stateTable: number[] = [0];
  stateShapes: number[] = [0];
  private stateMap = new Map<number, number>([[0, 0]]);
  onDirty: ((ci: number) => void) | null = null;
  /** Per-voxel edit hook, fired after every successful set() (any source: tools, undo, network). */
  onEdit: ((x: number, y: number, z: number, stateId: number) => void) | null = null;

  /** Number of distinct interned states (including air). */
  get stateCount(): number {
    return this.stateTable.length;
  }

  /** Return the stateId for (cls, rgb, shape), interning a new one when unseen. */
  internState(cls: number, rgb: number, shape = 0): number {
    const uniq = stateUniqueKey(packState(cls, rgb), shape);
    let id = this.stateMap.get(uniq);
    if (id === undefined) {
      id = this.stateTable.length;
      this.stateTable.push(packState(cls, rgb));
      this.stateShapes.push(shape);
      this.stateMap.set(uniq, id);
    }
    return id;
  }

  /** Resolved stateId at world coords; AIR when out of bounds or the chunk is empty. */
  get(x: number, y: number, z: number): number {
    if (!inWorld(x, y, z)) return AIR;
    const ci = cIndex(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    const chunk = this.chunks[ci];
    if (!chunk) return AIR;
    const m = CHUNK_SIZE - 1;
    return chunk.getState(vIndex(x & m, y & m, z & m));
  }

  /** Write a voxel; false when out of bounds or unchanged. Fires onDirty for affected chunks. */
  set(x: number, y: number, z: number, stateId: number): boolean {
    if (!inWorld(x, y, z)) return false;
    const cx = x >> CHUNK_BITS;
    const cy = y >> CHUNK_BITS;
    const cz = z >> CHUNK_BITS;
    const ci = cIndex(cx, cy, cz);
    let chunk = this.chunks[ci];
    if (!chunk) {
      if (stateId === AIR) return false;
      chunk = new Chunk();
      this.chunks[ci] = chunk;
    }
    const m = CHUNK_SIZE - 1;
    const lx = x & m;
    const ly = y & m;
    const lz = z & m;
    if (!chunk.setState(vIndex(lx, ly, lz), stateId)) return false;
    if (chunk.nonAir === 0) this.chunks[ci] = null;
    this.onEdit?.(x, y, z, stateId);
    const onDirty = this.onDirty;
    if (!onDirty) return true;
    onDirty(ci);
    const nx = lx === 0 ? 2 : lx === m ? 2 : 1;
    const ny = ly === 0 ? 2 : ly === m ? 2 : 1;
    const nz = lz === 0 ? 2 : lz === m ? 2 : 1;
    offsX[1] = lx === 0 ? -1 : 1;
    offsY[1] = ly === 0 ? -1 : 1;
    offsZ[1] = lz === 0 ? -1 : 1;
    for (let i = 0; i < nx; i++) {
      const ncx = cx + offsX[i];
      if (ncx < 0 || ncx >= WORLD_CX) continue;
      for (let j = 0; j < ny; j++) {
        const ncy = cy + offsY[j];
        if (ncy < 0 || ncy >= WORLD_CY) continue;
        for (let k = 0; k < nz; k++) {
          if (i === 0 && j === 0 && k === 0) continue;
          const ncz = cz + offsZ[k];
          if (ncz < 0 || ncz >= WORLD_CZ) continue;
          const nci = cIndex(ncx, ncy, ncz);
          if (this.chunks[nci]) onDirty(nci);
        }
      }
    }
    return true;
  }

  /** Total non-air voxels across all chunks. */
  voxelCount(): number {
    let total = 0;
    for (let ci = 0; ci < CHUNK_COUNT; ci++) {
      const chunk = this.chunks[ci];
      if (chunk) total += chunk.nonAir;
    }
    return total;
  }

  /** Voxel-tight AABB of all non-air content (max is exclusive), or null when empty. */
  contentBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let ci = 0; ci < CHUNK_COUNT; ci++) {
      const chunk = this.chunks[ci];
      if (!chunk) continue;
      const originX = (ci % WORLD_CX) << CHUNK_BITS;
      const originZ = (((ci / WORLD_CX) | 0) % WORLD_CZ) << CHUNK_BITS;
      const originY = ((ci / (WORLD_CX * WORLD_CZ)) | 0) << CHUNK_BITS;
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            if (chunk.getState(vIndex(x, y, z)) === AIR) continue;
            const wx = originX + x;
            const wy = originY + y;
            const wz = originZ + z;
            if (wx < minX) minX = wx;
            if (wy < minY) minY = wy;
            if (wz < minZ) minZ = wz;
            if (wx >= maxX) maxX = wx + 1;
            if (wy >= maxY) maxY = wy + 1;
            if (wz >= maxZ) maxZ = wz + 1;
          }
        }
      }
    }
    if (!Number.isFinite(minX)) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  /** Resolved, palette-free copy of the world for codecs. */
  toSnapshot(): WorldSnapshot {
    const chunks: { ci: number; states: Uint16Array }[] = [];
    for (let ci = 0; ci < CHUNK_COUNT; ci++) {
      const chunk = this.chunks[ci];
      if (!chunk) continue;
      const states = new Uint16Array(CHUNK_VOLUME);
      chunk.readStates(states);
      chunks.push({ ci, states });
    }
    return {
      sx: WORLD_SX,
      sy: WORLD_SY,
      sz: WORLD_SZ,
      stateTable: Uint32Array.from(this.stateTable),
      stateShapes: Uint8Array.from(this.stateShapes),
      chunks,
    };
  }

  /** Replace world contents from a snapshot; throws on dimension mismatch. Marks every chunk dirty. */
  loadSnapshot(s: WorldSnapshot): void {
    if (s.sx !== WORLD_SX || s.sy !== WORLD_SY || s.sz !== WORLD_SZ) {
      throw new Error(
        `snapshot dims ${s.sx}x${s.sy}x${s.sz} != world ${WORLD_SX}x${WORLD_SY}x${WORLD_SZ}`,
      );
    }
    if (s.stateTable[0] !== 0) throw new Error("snapshot stateTable[0] must be 0 (air)");
    if (s.stateShapes.length !== s.stateTable.length) {
      throw new Error("snapshot tables length mismatch");
    }
    this.stateTable = Array.from(s.stateTable);
    this.stateShapes = Array.from(s.stateShapes);
    this.stateShapes[0] = 0;
    this.stateMap.clear();
    for (let id = 0; id < this.stateTable.length; id++) {
      this.stateMap.set(stateUniqueKey(this.stateTable[id], this.stateShapes[id]), id);
    }
    this.chunks.fill(null);
    for (const { ci, states } of s.chunks) this.chunks[ci] = Chunk.fromStates(states);
    const onDirty = this.onDirty;
    if (onDirty) for (let ci = 0; ci < CHUNK_COUNT; ci++) onDirty(ci);
  }

  /** Empty the world and reset interned states; marks previously occupied chunks dirty. */
  clear(): void {
    const onDirty = this.onDirty;
    for (let ci = 0; ci < CHUNK_COUNT; ci++) {
      if (!this.chunks[ci]) continue;
      this.chunks[ci] = null;
      if (onDirty) onDirty(ci);
    }
    this.stateTable = [0];
    this.stateShapes = [0];
    this.stateMap.clear();
    this.stateMap.set(0, 0);
  }
}
