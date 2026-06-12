import { AIR, CHUNK_VOLUME } from "./types";

const MAX_PALETTE = 256;

/** Paletted voxel storage for one 32³ chunk; upgrades to direct Uint16 storage on palette overflow. */
export class Chunk {
  private data = new Uint8Array(CHUNK_VOLUME);
  private palette: number[] = [AIR];
  private paletteMap = new Map<number, number>([[AIR, 0]]);
  private data16: Uint16Array | null = null;
  private nonAirCount = 0;

  // ── reads ───────────────────────────────────────────────────────────────────

  /** Number of non-air voxels in this chunk. */
  get nonAir(): number {
    return this.nonAirCount;
  }

  /** True once the chunk has overflowed its palette into direct Uint16 storage. */
  get isDirect(): boolean {
    return this.data16 !== null;
  }

  /** Resolved stateId at voxel index `vi`. */
  getState(vi: number): number {
    const d16 = this.data16;
    return d16 ? d16[vi] : this.palette[this.data[vi]];
  }

  // ── writes ──────────────────────────────────────────────────────────────────

  /** Write `stateId` at `vi`; returns whether the voxel changed. */
  setState(vi: number, stateId: number): boolean {
    const d16 = this.data16;
    if (d16) {
      const prev = d16[vi];
      if (prev === stateId) return false;
      d16[vi] = stateId;
      if (prev === AIR) this.nonAirCount++;
      else if (stateId === AIR) this.nonAirCount--;
      return true;
    }

    const prevId = this.palette[this.data[vi]];
    if (prevId === stateId) return false;

    let pi = this.paletteMap.get(stateId);
    if (pi === undefined) {
      if (this.palette.length >= MAX_PALETTE) {
        this.compact();
        if (this.palette.length >= MAX_PALETTE) {
          this.upgrade();
          return this.setState(vi, stateId);
        }
      }
      pi = this.palette.length;
      this.palette.push(stateId);
      this.paletteMap.set(stateId, pi);
    }

    this.data[vi] = pi;

    if (prevId === AIR) this.nonAirCount++;
    else if (stateId === AIR) this.nonAirCount--;
    return true;
  }

  // ── bulk I/O ────────────────────────────────────────────────────────────────

  /** Write all 32768 resolved stateIds into `out`. */
  readStates(out: Uint16Array): void {
    const d16 = this.data16;
    if (d16) {
      out.set(d16);
      return;
    }

    const data = this.data;
    const palette = this.palette;
    for (let i = 0; i < CHUNK_VOLUME; i++) out[i] = palette[data[i]];
  }

  /** Build a chunk from resolved stateIds, interning a fresh palette; null when all air. */
  static fromStates(states: Uint16Array): Chunk | null {
    const c = new Chunk();
    const data = c.data;
    const palette = c.palette;
    const map = c.paletteMap;
    let nonAir = 0;

    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const s = states[i];
      if (s !== AIR) nonAir++;
      let pi = map.get(s);
      if (pi === undefined) {
        if (palette.length >= MAX_PALETTE) {
          for (let j = i + 1; j < CHUNK_VOLUME; j++) if (states[j] !== AIR) nonAir++;
          c.data16 = states.slice();
          c.nonAirCount = nonAir;
          return c;
        }
        pi = palette.length;
        palette.push(s);
        map.set(s, pi);
      }
      data[i] = pi;
    }

    if (nonAir === 0) return null;
    c.nonAirCount = nonAir;
    return c;
  }

  // ── palette maintenance ─────────────────────────────────────────────────────

  /** Drop unused palette entries and remap stored indices; index 0 stays AIR. */
  private compact(): void {
    const data = this.data;
    const usage = new Uint32Array(MAX_PALETTE);
    for (let i = 0; i < CHUNK_VOLUME; i++) usage[data[i]]++;

    const oldPalette = this.palette;
    const palette: number[] = [AIR];
    const map = new Map<number, number>([[AIR, 0]]);
    const lut = new Uint8Array(MAX_PALETTE);
    for (let pi = 1; pi < oldPalette.length; pi++) {
      if (usage[pi] === 0) continue;
      const id = oldPalette[pi];
      lut[pi] = palette.length;
      map.set(id, palette.length);
      palette.push(id);
    }

    for (let i = 0; i < CHUNK_VOLUME; i++) data[i] = lut[data[i]];
    this.palette = palette;
    this.paletteMap = map;
  }

  /** Switch to direct Uint16 storage; palette path is disabled afterwards. */
  private upgrade(): void {
    const d16 = new Uint16Array(CHUNK_VOLUME);
    const data = this.data;
    const palette = this.palette;
    for (let i = 0; i < CHUNK_VOLUME; i++) d16[i] = palette[data[i]];

    this.data16 = d16;
    this.palette = [AIR];
    this.paletteMap.clear();
  }
}
