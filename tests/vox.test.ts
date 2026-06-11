import { describe, expect, test } from "bun:test";
import {
  CHUNK_BITS,
  CHUNK_VOLUME,
  cIndex,
  MaterialClass,
  packState,
  stateRgb,
  vIndex,
  WORLD_CX,
  WORLD_CZ,
  type WorldSnapshot,
} from "../src/core/types";
import { exportVox, importVox } from "../src/io/vox";

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const MASK = (1 << CHUNK_BITS) - 1;

const snapshotOf = (voxels: [number, number, number, number, number][]): WorldSnapshot => {
  const keys = [0];
  const idOf = new Map<number, number>();
  const chunkMap = new Map<number, Uint16Array>();
  for (const [x, y, z, rgb, cls] of voxels) {
    const key = packState(cls, rgb);
    let id = idOf.get(key);
    if (id === undefined) {
      id = keys.length;
      idOf.set(key, id);
      keys.push(key);
    }
    const ci = cIndex(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    let states = chunkMap.get(ci);
    if (!states) {
      states = new Uint16Array(CHUNK_VOLUME);
      chunkMap.set(ci, states);
    }
    states[vIndex(x & MASK, y & MASK, z & MASK)] = id;
  }
  const chunks = [...chunkMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ci, states]) => ({ ci, states }));
  return {
    sx: 256,
    sy: 128,
    sz: 256,
    stateTable: Uint32Array.from(keys),
    stateShapes: new Uint8Array(keys.length),
    chunks,
  };
};

const collect = (s: WorldSnapshot): string[] => {
  const out: string[] = [];
  for (const { ci, states } of s.chunks) {
    const bx = (ci % WORLD_CX) << CHUNK_BITS;
    const bz = (((ci / WORLD_CX) | 0) % WORLD_CZ) << CHUNK_BITS;
    const by = ((ci / (WORLD_CX * WORLD_CZ)) | 0) << CHUNK_BITS;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = states[i]!;
      if (v === 0) continue;
      const x = bx + (i & MASK);
      const z = bz + ((i >> CHUNK_BITS) & MASK);
      const y = by + (i >> (CHUNK_BITS << 1));
      out.push(`${x},${y},${z}:${stateRgb(s.stateTable[v]!)}`);
    }
  }
  return out.sort();
};

const readPalette = (bytes: Uint8Array): Set<number> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 12 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!);
    const content = view.getUint32(off + 4, true);
    off += 12;
    if (id === "RGBA") {
      const set = new Set<number>();
      for (let i = 0; i < 255; i++) {
        const o = off + i * 4;
        set.add((bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!);
      }
      return set;
    }
    if (id !== "MAIN") off += content;
  }
  throw new Error("no RGBA chunk found");
};

const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];

const voxChunk = (id: string, content: number[]): number[] => [
  id.charCodeAt(0),
  id.charCodeAt(1),
  id.charCodeAt(2),
  id.charCodeAt(3),
  ...u32(content.length),
  ...u32(0),
  ...content,
];

const voxFile = (children: number[]): Uint8Array =>
  Uint8Array.from([
    0x56,
    0x4f,
    0x58,
    0x20,
    ...u32(150),
    ...voxChunk("MAIN", []).slice(0, 8),
    ...u32(children.length),
    ...children,
  ]);

describe("vox", () => {
  test("roundtrips colors and positions when centering offset is identity", () => {
    const voxels: [number, number, number, number, number][] = [
      [126, 0, 126, 0xff0000, MaterialClass.Gloss],
      [127, 1, 127, 0x00ff00, MaterialClass.Emissive],
      [128, 0, 129, 0x0000ff, MaterialClass.Matte],
    ];
    const mx = 128 - 126 + 1;
    const mz = 129 - 126 + 1;
    expect((256 - mx) >> 1).toBe(126);
    expect((256 - mz) >> 1).toBe(126);
    const s = snapshotOf(voxels);
    const d = importVox(exportVox(s));
    expect(collect(d)).toEqual(collect(s));
    expect([...d.stateShapes]).toEqual(new Array(d.stateTable.length).fill(0));
    for (let i = 1; i < d.stateTable.length; i++) {
      expect(d.stateTable[i]! >>> 24).toBe(MaterialClass.Matte);
    }
  });

  test("clamps 300 colors to <=255 palette entries, preserving voxel count", () => {
    const rand = mulberry32(0x70a57);
    const rgbs = new Set<number>();
    while (rgbs.size < 300) rgbs.add((rand() * 0x1000000) | 0);
    const voxels = [...rgbs].map((rgb, i): [number, number, number, number, number] => [
      100 + (i % 20),
      0,
      100 + ((i / 20) | 0),
      rgb,
      MaterialClass.Matte,
    ]);
    const bytes = exportVox(snapshotOf(voxels));
    const palette = readPalette(bytes);
    const d = importVox(bytes);
    expect(d.stateTable.length - 1).toBeLessThanOrEqual(255);
    expect(collect(d).length).toBe(300);
    for (let i = 1; i < d.stateTable.length; i++) {
      expect(palette.has(stateRgb(d.stateTable[i]!))).toBe(true);
    }
  });

  test("parses a minimal file without RGBA via the fallback palette", () => {
    const bytes = voxFile([
      ...voxChunk("SIZE", [...u32(1), ...u32(1), ...u32(1)]),
      ...voxChunk("XYZI", [...u32(1), 0, 0, 0, 5]),
    ]);
    const d = importVox(bytes);
    const got = collect(d);
    expect(got.length).toBe(1);
    const rgb = stateRgb(d.stateTable[1]!);
    expect(got[0]).toBe(`127,0,127:${rgb}`);
    expect(d.stateTable[1]! >>> 24).toBe(MaterialClass.Matte);
    expect(collect(importVox(bytes))).toEqual(got);
  });

  test("skips unknown chunk ids before SIZE", () => {
    const palette: number[] = new Array<number>(1024).fill(0);
    palette[0] = 10;
    palette[1] = 20;
    palette[2] = 30;
    palette[3] = 255;
    const bytes = voxFile([
      ...voxChunk("nTRN", [1, 2, 3, 4, 5]),
      ...voxChunk("SIZE", [...u32(1), ...u32(1), ...u32(1)]),
      ...voxChunk("XYZI", [...u32(1), 0, 0, 0, 1]),
      ...voxChunk("RGBA", palette),
    ]);
    const d = importVox(bytes);
    expect(collect(d)).toEqual([`127,0,127:${(10 << 16) | (20 << 8) | 30}`]);
  });
});
