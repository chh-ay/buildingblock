/**
 * MagicaVoxel .vox interchange: single SIZE/XYZI/RGBA model, version 150,
 * z-up axis swap (vox(x,y,z) = ours(x,z,y)). Material classes flatten to Matte.
 */
import {
  CHUNK_BITS,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  cIndex,
  inWorld,
  packState,
  stateRgb,
  vIndex,
  WORLD_CX,
  WORLD_CZ,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
  type WorldSnapshot,
} from "../core/types";

const MASK = CHUNK_SIZE - 1;

const hsvToRgb = (h: number, s: number, v: number): number => {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const r = [v, q, p, p, t, v][i]!;
  const g = [t, v, v, q, p, p][i]!;
  const b = [p, p, t, v, v, q][i]!;
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
};

/**
 * Programmatic stand-in for MagicaVoxel's canonical default palette, used when
 * a file carries no RGBA chunk: 240 hue×value ramp entries (24 hues × 10
 * values) followed by 15 grays — 255 entries addressed by color index 1..255.
 */
const fallbackPalette = (): Uint32Array => {
  const pal = new Uint32Array(255);
  for (let i = 0; i < 240; i++) {
    pal[i] = hsvToRgb((i % 24) / 24, 1, (((i / 24) | 0) + 1) / 10);
  }
  for (let i = 0; i < 15; i++) {
    const g = Math.round(((i + 1) / 16) * 255);
    pal[240 + i] = (g << 16) | (g << 8) | g;
  }
  return pal;
};

const writeId = (bytes: Uint8Array, off: number, id: string): void => {
  bytes[off] = id.charCodeAt(0);
  bytes[off + 1] = id.charCodeAt(1);
  bytes[off + 2] = id.charCodeAt(2);
  bytes[off + 3] = id.charCodeAt(3);
};

/** Exports non-air voxels as a tightly-bounded vox model; shapes flatten to full voxels (vox has no shape concept) and >255 colors keep the most frequent, rest map to nearest by squared RGB distance. */
export const exportVox = (s: WorldSnapshot): Uint8Array<ArrayBuffer> => {
  const table = s.stateTable;
  let n = 0;
  for (let c = 0; c < s.chunks.length; c++) {
    const st = s.chunks[c]!.states;
    for (let i = 0; i < CHUNK_VOLUME; i++) if (st[i] !== 0) n++;
  }
  const px = new Int32Array(n);
  const py = new Int32Array(n);
  const pz = new Int32Array(n);
  const prgb = new Int32Array(n);
  const freq = new Map<number, number>();
  let minX = WORLD_SX;
  let minY = WORLD_SY;
  let minZ = WORLD_SZ;
  let maxX = -1;
  let maxY = -1;
  let maxZ = -1;
  let k = 0;
  for (let c = 0; c < s.chunks.length; c++) {
    const { ci, states } = s.chunks[c]!;
    const bx = (ci % WORLD_CX) << CHUNK_BITS;
    const bz = (((ci / WORLD_CX) | 0) % WORLD_CZ) << CHUNK_BITS;
    const by = ((ci / (WORLD_CX * WORLD_CZ)) | 0) << CHUNK_BITS;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = states[i]!;
      if (v === 0) continue;
      const x = bx + (i & MASK);
      const z = bz + ((i >> CHUNK_BITS) & MASK);
      const y = by + (i >> (CHUNK_BITS << 1));
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
      const rgb = stateRgb(table[v]!);
      px[k] = x;
      py[k] = y;
      pz[k] = z;
      prgb[k] = rgb;
      k++;
      freq.set(rgb, (freq.get(rgb) ?? 0) + 1);
    }
  }
  let colors: number[];
  if (freq.size <= 255) {
    colors = [...freq.keys()];
  } else {
    colors = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 255)
      .map((e) => e[0]);
  }
  const index = new Map<number, number>();
  for (let i = 0; i < colors.length; i++) index.set(colors[i]!, i + 1);
  if (freq.size > 255) {
    for (const rgb of freq.keys()) {
      if (index.has(rgb)) continue;
      const r = (rgb >> 16) & 255;
      const g = (rgb >> 8) & 255;
      const b = rgb & 255;
      let best = 1;
      let bestD = Infinity;
      for (let i = 0; i < colors.length; i++) {
        const c2 = colors[i]!;
        const dr = r - ((c2 >> 16) & 255);
        const dg = g - ((c2 >> 8) & 255);
        const db = b - (c2 & 255);
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = i + 1;
        }
      }
      index.set(rgb, best);
    }
  }
  const mx = n > 0 ? maxX - minX + 1 : 0;
  const my = n > 0 ? maxY - minY + 1 : 0;
  const mz = n > 0 ? maxZ - minZ + 1 : 0;
  const sizeBytes = 12 + 12;
  const xyziBytes = 12 + 4 + n * 4;
  const rgbaBytes = 12 + 1024;
  const bytes = new Uint8Array(8 + 12 + sizeBytes + xyziBytes + rgbaBytes);
  const view = new DataView(bytes.buffer);
  writeId(bytes, 0, "VOX ");
  view.setUint32(4, 150, true);
  writeId(bytes, 8, "MAIN");
  view.setUint32(12, 0, true);
  view.setUint32(16, sizeBytes + xyziBytes + rgbaBytes, true);
  let off = 20;
  writeId(bytes, off, "SIZE");
  view.setUint32(off + 4, 12, true);
  view.setUint32(off + 8, 0, true);
  view.setUint32(off + 12, mx, true);
  view.setUint32(off + 16, mz, true);
  view.setUint32(off + 20, my, true);
  off += 24;
  writeId(bytes, off, "XYZI");
  view.setUint32(off + 4, 4 + n * 4, true);
  view.setUint32(off + 8, 0, true);
  view.setUint32(off + 12, n, true);
  off += 16;
  for (let i = 0; i < n; i++) {
    bytes[off] = px[i]! - minX;
    bytes[off + 1] = pz[i]! - minZ;
    bytes[off + 2] = py[i]! - minY;
    bytes[off + 3] = index.get(prgb[i]!)!;
    off += 4;
  }
  writeId(bytes, off, "RGBA");
  view.setUint32(off + 4, 1024, true);
  view.setUint32(off + 8, 0, true);
  off += 12;
  for (let i = 0; i < colors.length; i++) {
    const rgb = colors[i]!;
    const o = off + i * 4;
    bytes[o] = (rgb >> 16) & 255;
    bytes[o + 1] = (rgb >> 8) & 255;
    bytes[o + 2] = rgb & 255;
    bytes[o + 3] = 255;
  }
  return bytes;
};

/** Imports the first SIZE+XYZI model (unknown chunk ids skipped), centers it on the baseplate, clips to world bounds; all states Matte. */
export const importVox = (bytes: Uint8Array): WorldSnapshot => {
  const len = bytes.byteLength;
  if (len < 8 || bytes[0] !== 0x56 || bytes[1] !== 0x4f || bytes[2] !== 0x58 || bytes[3] !== 0x20) {
    throw new Error("vox: bad magic");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, len);
  let off = 8;
  let sizeOff = -1;
  let xyziOff = -1;
  let rgbaOff = -1;
  while (off + 12 <= len) {
    const id = String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!);
    const content = view.getUint32(off + 4, true);
    off += 12;
    if (off + content > len) throw new Error("vox: truncated chunk");
    if (id === "SIZE" && sizeOff < 0 && content >= 12) sizeOff = off;
    else if (id === "XYZI" && xyziOff < 0 && content >= 4) xyziOff = off;
    else if (id === "RGBA" && rgbaOff < 0 && content >= 1024) rgbaOff = off;
    if (id !== "MAIN") off += content;
  }
  if (sizeOff < 0 || xyziOff < 0) throw new Error("vox: missing SIZE or XYZI");
  const mx = view.getUint32(sizeOff, true);
  const mz = view.getUint32(sizeOff + 4, true);
  const n = view.getUint32(xyziOff, true);
  if (xyziOff + 4 + n * 4 > len) throw new Error("vox: truncated XYZI");
  let palette: Uint32Array;
  if (rgbaOff >= 0) {
    palette = new Uint32Array(255);
    for (let i = 0; i < 255; i++) {
      const o = rgbaOff + i * 4;
      palette[i] = (bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!;
    }
  } else {
    palette = fallbackPalette();
  }
  const offX = (WORLD_SX - mx) >> 1;
  const offZ = (WORLD_SZ - mz) >> 1;
  const chunkMap = new Map<number, Uint16Array>();
  const stateOf = new Map<number, number>();
  const keys: number[] = [0];
  let p = xyziOff + 4;
  for (let i = 0; i < n; i++, p += 4) {
    const colorIndex = bytes[p + 3]!;
    if (colorIndex === 0) continue;
    const x = bytes[p]! + offX;
    const z = bytes[p + 1]! + offZ;
    const y = bytes[p + 2]!;
    if (!inWorld(x, y, z)) continue;
    const rgb = palette[colorIndex - 1]!;
    let sid = stateOf.get(rgb);
    if (sid === undefined) {
      sid = keys.length;
      stateOf.set(rgb, sid);
      keys.push(packState(0, rgb));
    }
    const ci = cIndex(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    let states = chunkMap.get(ci);
    if (!states) {
      states = new Uint16Array(CHUNK_VOLUME);
      chunkMap.set(ci, states);
    }
    states[vIndex(x & MASK, y & MASK, z & MASK)] = sid;
  }
  const chunks = [...chunkMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ci, states]) => ({ ci, states }));
  return {
    sx: WORLD_SX,
    sy: WORLD_SY,
    sz: WORLD_SZ,
    stateTable: Uint32Array.from(keys),
    stateShapes: new Uint8Array(keys.length),
    chunks,
  };
};
