import { describe, expect, test } from "bun:test";
import { CHUNK_VOLUME, packState, type WorldSnapshot } from "../src/core/types";
import { decodeSnapshot, encodeSnapshot, peekDims } from "../src/io/codec";

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buildSnapshot = (): WorldSnapshot => {
  const rand = mulberry32(0xb10c5);
  const stateTable = new Uint32Array(301);
  for (let i = 1; i <= 300; i++) {
    stateTable[i] = packState((rand() * 4) | 0, (rand() * 0x1000000) | 0);
  }
  const stateShapes = new Uint8Array(301);
  for (let i = 1; i <= 300; i++) stateShapes[i] = 1 + ((rand() * 255) | 0);
  const cis = new Set<number>();
  while (cis.size < 25) cis.add((rand() * 256) | 0);
  const chunks = [...cis]
    .sort((a, b) => a - b)
    .map((ci) => {
      const states = new Uint16Array(CHUNK_VOLUME);
      let i = 0;
      while (i < CHUNK_VOLUME) {
        const len = Math.min(
          CHUNK_VOLUME - i,
          rand() < 0.5 ? 1 + ((rand() * 8) | 0) : 100 + ((rand() * 4000) | 0),
        );
        states.fill((rand() * 301) | 0, i, i + len);
        i += len;
      }
      return { ci, states };
    });
  return { sx: 256, sy: 128, sz: 256, stateTable, stateShapes, chunks };
};

const encodeV1 = (s: WorldSnapshot): Uint8Array => {
  const chunkRuns = s.chunks.map(({ states }) => {
    const runs: number[] = [];
    let prev = states[0]!;
    let count = 1;
    for (let i = 1; i < CHUNK_VOLUME; i++) {
      const v = states[i]!;
      if (v === prev) {
        count++;
        continue;
      }
      runs.push(prev, count);
      prev = v;
      count = 1;
    }
    runs.push(prev, count);
    return runs;
  });
  const totalRuns = chunkRuns.reduce((a, r) => a + r.length / 2, 0);
  const bytes = new Uint8Array(
    12 + 2 + s.stateTable.length * 4 + 2 + s.chunks.length * 6 + totalRuns * 4,
  );
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x42, 0x4b, 0x31], 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, s.sx, true);
  view.setUint16(8, s.sy, true);
  view.setUint16(10, s.sz, true);
  let off = 12;
  view.setUint16(off, s.stateTable.length, true);
  off += 2;
  for (let i = 0; i < s.stateTable.length; i++) {
    view.setUint32(off, s.stateTable[i]!, true);
    off += 4;
  }
  view.setUint16(off, s.chunks.length, true);
  off += 2;
  for (let c = 0; c < s.chunks.length; c++) {
    view.setUint16(off, s.chunks[c]!.ci, true);
    view.setUint32(off + 2, chunkRuns[c]!.length / 2, true);
    off += 6;
    const runs = chunkRuns[c]!;
    for (let r = 0; r < runs.length; r += 2) {
      view.setUint16(off, runs[r]!, true);
      view.setUint16(off + 2, runs[r + 1]!, true);
      off += 4;
    }
  }
  return bytes;
};

describe("codec", () => {
  test("roundtrips a seeded random snapshot", () => {
    const s = buildSnapshot();
    const d = decodeSnapshot(encodeSnapshot(s));
    expect(d.sx).toBe(s.sx);
    expect(d.sy).toBe(s.sy);
    expect(d.sz).toBe(s.sz);
    expect([...d.stateTable]).toEqual([...s.stateTable]);
    expect([...d.stateShapes]).toEqual([...s.stateShapes]);
    expect(d.chunks.length).toBe(s.chunks.length);
    for (let i = 0; i < s.chunks.length; i++) {
      expect(d.chunks[i]!.ci).toBe(s.chunks[i]!.ci);
      expect(d.chunks[i]!.states).toEqual(s.chunks[i]!.states);
    }
  });

  test("roundtrips an all-empty snapshot", () => {
    const s: WorldSnapshot = {
      sx: 256,
      sy: 128,
      sz: 256,
      stateTable: Uint32Array.of(0),
      stateShapes: Uint8Array.of(0),
      chunks: [],
    };
    const d = decodeSnapshot(encodeSnapshot(s));
    expect(d.chunks).toEqual([]);
    expect([...d.stateTable]).toEqual([0]);
    expect([...d.stateShapes]).toEqual([0]);
  });

  test("throws on corrupted magic", () => {
    const bytes = encodeSnapshot(buildSnapshot());
    bytes[0] = 0x58;
    expect(() => decodeSnapshot(bytes)).toThrow(/^bbk:/);
  });

  test("throws on truncated buffer", () => {
    const bytes = encodeSnapshot(buildSnapshot());
    expect(() => decodeSnapshot(bytes.subarray(0, bytes.length - 10))).toThrow(/^bbk:/);
    expect(() => decodeSnapshot(bytes.subarray(0, 6))).toThrow(/^bbk:/);
  });

  test("throws on bad run sums", () => {
    const short = new Uint8Array(30);
    const v1 = new DataView(short.buffer);
    short.set([0x42, 0x42, 0x4b, 0x31], 0);
    v1.setUint16(4, 1, true);
    v1.setUint16(6, 256, true);
    v1.setUint16(8, 128, true);
    v1.setUint16(10, 256, true);
    v1.setUint16(12, 1, true);
    v1.setUint32(14, 0, true);
    v1.setUint16(18, 1, true);
    v1.setUint16(20, 0, true);
    v1.setUint32(22, 1, true);
    v1.setUint16(26, 0, true);
    v1.setUint16(28, 100, true);
    expect(() => decodeSnapshot(short)).toThrow(/^bbk: bad run sum/);

    const long = new Uint8Array(34);
    const v2 = new DataView(long.buffer);
    long.set(short.subarray(0, 26), 0);
    v2.setUint32(22, 2, true);
    v2.setUint16(26, 0, true);
    v2.setUint16(28, 32768, true);
    v2.setUint16(30, 0, true);
    v2.setUint16(32, 4, true);
    expect(() => decodeSnapshot(long)).toThrow(/^bbk: bad run sum/);
  });

  test("decodes a v1 buffer with zero shapes", () => {
    const s = buildSnapshot();
    const bytes = encodeV1(s);
    expect(peekDims(bytes)).toEqual({ sx: 256, sy: 128, sz: 256 });
    const d = decodeSnapshot(bytes);
    expect([...d.stateTable]).toEqual([...s.stateTable]);
    expect([...d.stateShapes]).toEqual(new Array(301).fill(0));
    expect(d.chunks.length).toBe(s.chunks.length);
    for (let i = 0; i < s.chunks.length; i++) {
      expect(d.chunks[i]!.states).toEqual(s.chunks[i]!.states);
    }
  });

  test("throws on truncation inside the v2 shape block", () => {
    const bytes = encodeSnapshot(buildSnapshot());
    expect(peekDims(bytes)).toEqual({ sx: 256, sy: 128, sz: 256 });
    const cut = 12 + 2 + 301 * 4 + 100;
    expect(() => decodeSnapshot(bytes.subarray(0, cut))).toThrow(/^bbk: truncated/);
  });
});
