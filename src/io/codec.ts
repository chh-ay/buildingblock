/**
 * BBK binary snapshot codec (writes v2, reads v1/v2): little-endian header +
 * state key table (+ v2 shape table) + per-chunk RLE over the 32768 state
 * entries in index order. No compression here (gzip layers above).
 */
import { CHUNK_BITS, CHUNK_VOLUME, type WorldSnapshot } from "../core/types";

/** Reads just the dimensions from a BBK header (v1 or v2); null when not a BBK buffer. */
export const peekDims = (bytes: Uint8Array): { sx: number; sy: number; sz: number } | null => {
  if (bytes.length < 12) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x42 || bytes[2] !== 0x4b || bytes[3] !== 0x31) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== 1 && version !== 2) return null;
  return {
    sx: view.getUint16(6, true),
    sy: view.getUint16(8, true),
    sz: view.getUint16(10, true),
  };
};

/** Encodes a snapshot into an exact-size BBK v2 byte buffer. */
export const encodeSnapshot = (s: WorldSnapshot): Uint8Array<ArrayBuffer> => {
  const { stateTable, stateShapes, chunks } = s;
  const runCounts = new Uint32Array(chunks.length);
  let totalRuns = 0;
  for (let c = 0; c < chunks.length; c++) {
    const states = chunks[c]!.states;
    let runs = 1;
    let prev = states[0]!;
    for (let i = 1; i < CHUNK_VOLUME; i++) {
      const v = states[i]!;
      if (v !== prev) {
        runs++;
        prev = v;
      }
    }
    runCounts[c] = runs;
    totalRuns += runs;
  }
  const size = 12 + 2 + stateTable.length * 5 + 2 + chunks.length * 6 + totalRuns * 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x42;
  bytes[2] = 0x4b;
  bytes[3] = 0x31;
  view.setUint16(4, 2, true);
  view.setUint16(6, s.sx, true);
  view.setUint16(8, s.sy, true);
  view.setUint16(10, s.sz, true);
  let off = 12;
  view.setUint16(off, stateTable.length, true);
  off += 2;
  for (let i = 0; i < stateTable.length; i++) {
    view.setUint32(off, stateTable[i]!, true);
    off += 4;
  }
  for (let i = 0; i < stateTable.length; i++) {
    bytes[off] = stateShapes[i]!;
    off += 1;
  }
  view.setUint16(off, chunks.length, true);
  off += 2;
  for (let c = 0; c < chunks.length; c++) {
    const { ci, states } = chunks[c]!;
    view.setUint16(off, ci, true);
    view.setUint32(off + 2, runCounts[c]!, true);
    off += 6;
    let prev = states[0]!;
    let count = 1;
    for (let i = 1; i < CHUNK_VOLUME; i++) {
      const v = states[i]!;
      if (v === prev) {
        count++;
        continue;
      }
      view.setUint16(off, prev, true);
      view.setUint16(off + 2, count, true);
      off += 4;
      prev = v;
      count = 1;
    }
    view.setUint16(off, prev, true);
    view.setUint16(off + 2, count, true);
    off += 4;
  }
  return bytes;
};

/** Decodes BBK1 bytes into a snapshot, validating structure; throws Error('bbk: …') on malformed input. */
export const decodeSnapshot = (bytes: Uint8Array): WorldSnapshot => {
  const len = bytes.byteLength;
  const view = new DataView(bytes.buffer, bytes.byteOffset, len);
  let off = 0;
  const need = (n: number): void => {
    if (off + n > len) throw new Error("bbk: truncated");
  };
  need(12);
  if (bytes[0] !== 0x42 || bytes[1] !== 0x42 || bytes[2] !== 0x4b || bytes[3] !== 0x31) {
    throw new Error("bbk: bad magic");
  }
  const version = view.getUint16(4, true);
  if (version !== 1 && version !== 2) throw new Error(`bbk: unsupported version ${version}`);
  const sx = view.getUint16(6, true);
  const sy = view.getUint16(8, true);
  const sz = view.getUint16(10, true);
  // Validate against the snapshot's own grid — the live world may be a different size.
  const snapshotChunkCount = (sx >> CHUNK_BITS) * (sy >> CHUNK_BITS) * (sz >> CHUNK_BITS);
  off = 12;
  need(2);
  const stateCount = view.getUint16(off, true);
  off += 2;
  if (stateCount < 1) throw new Error("bbk: empty state table");
  need(stateCount * 4);
  const stateTable = new Uint32Array(stateCount);
  for (let i = 0; i < stateCount; i++) {
    stateTable[i] = view.getUint32(off, true);
    off += 4;
  }
  if (stateTable[0] !== 0) throw new Error("bbk: state 0 must be air");
  const stateShapes = new Uint8Array(stateCount);
  if (version === 2) {
    need(stateCount);
    stateShapes.set(bytes.subarray(off, off + stateCount));
    off += stateCount;
  }
  need(2);
  const chunkCount = view.getUint16(off, true);
  off += 2;
  const chunks: { ci: number; states: Uint16Array }[] = [];
  let prevCi = -1;
  for (let c = 0; c < chunkCount; c++) {
    need(6);
    const ci = view.getUint16(off, true);
    const runCount = view.getUint32(off + 2, true);
    off += 6;
    if (ci >= snapshotChunkCount || ci <= prevCi) throw new Error("bbk: bad chunk index");
    prevCi = ci;
    need(runCount * 4);
    const states = new Uint16Array(CHUNK_VOLUME);
    let filled = 0;
    for (let r = 0; r < runCount; r++) {
      const value = view.getUint16(off, true);
      const count = view.getUint16(off + 2, true);
      off += 4;
      if (value >= stateCount) throw new Error("bbk: state id out of range");
      if (count < 1 || filled + count > CHUNK_VOLUME) throw new Error("bbk: bad run sum");
      if (value !== 0) states.fill(value, filled, filled + count);
      filled += count;
    }
    if (filled !== CHUNK_VOLUME) throw new Error("bbk: bad run sum");
    chunks.push({ ci, states });
  }
  return { sx, sy, sz, stateTable, stateShapes, chunks };
};
