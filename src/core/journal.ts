/**
 * Append-only voxel edit log with an opaque baseline snapshot, for build replay.
 *
 * Entries are packed into segmented Uint32Array pairs (segments of 65536 entries,
 * two u32s per entry) so recording never allocates per-record and never grows by
 * copying. Coordinates are bounded by the world preset cap of 384x128x384, so
 * x and z fit in 9 bits and y fits in 8; shape ids fit in 3 bits (SHAPE_COUNT=7).
 */

export interface JournalEntry {
  x: number;
  y: number;
  z: number;
  key32: number;
  shape: number;
}

const SEGMENT_ENTRIES = 65536;
const SEGMENT_SHIFT = 16;
const SEGMENT_MASK = SEGMENT_ENTRIES - 1;

export class EditJournal {
  private readonly capacity: number;
  private segments: (Uint32Array | null)[] = [];
  private entryCount = 0;
  private overflowLatched = false;
  private baselineBytes: Uint8Array | null = null;

  constructor(capacity = 1 << 20) {
    this.capacity = capacity;
  }

  /** Encoded world bytes at the start of the current era (opaque); null = empty world. */
  get baseline(): Uint8Array | null {
    return this.baselineBytes;
  }

  get length(): number {
    return this.entryCount;
  }

  /** Latched true once capacity is hit; further records are dropped. reset() clears it. */
  get overflowed(): boolean {
    return this.overflowLatched;
  }

  /** Start a new journal era; drops all segments without zeroing. */
  reset(baseline: Uint8Array | null): void {
    this.baselineBytes = baseline;
    this.entryCount = 0;
    this.overflowLatched = false;
    this.segments = [];
  }

  record(x: number, y: number, z: number, key32: number, shape: number): void {
    if (this.entryCount >= this.capacity) {
      this.overflowLatched = true;
      return;
    }
    const index = this.entryCount;
    const segmentIndex = index >>> SEGMENT_SHIFT;
    let segment = this.segments[segmentIndex];
    if (segment === undefined || segment === null) {
      segment = new Uint32Array(SEGMENT_ENTRIES * 2);
      this.segments[segmentIndex] = segment;
    }
    const offset = (index & SEGMENT_MASK) * 2;
    segment[offset] = (x & 511) | ((y & 255) << 9) | ((z & 511) << 17) | ((shape & 7) << 26);
    segment[offset + 1] = key32 >>> 0;
    this.entryCount = index + 1;
  }

  /** Fills and returns `out`; throws RangeError when i is out of range. */
  entryAt(i: number, out: JournalEntry): JournalEntry {
    if (!Number.isInteger(i) || i < 0 || i >= this.entryCount) {
      throw new RangeError(`journal index ${i} out of range [0, ${this.entryCount})`);
    }
    const segment = this.segments[i >>> SEGMENT_SHIFT] as Uint32Array;
    const offset = (i & SEGMENT_MASK) * 2;
    const a = segment[offset] as number;
    out.x = a & 511;
    out.y = (a >>> 9) & 255;
    out.z = (a >>> 17) & 511;
    out.shape = (a >>> 26) & 7;
    out.key32 = (segment[offset + 1] as number) >>> 0;
    return out;
  }
}

/** Replay duration: 3ms per entry, clamped to [4000, 22000]. */
export const replayDurationMs = (entryCount: number): number =>
  Math.min(22000, Math.max(4000, entryCount * 3));

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Entries that should be applied after elapsedMs of a replay lasting durationMs.
 * Monotonic in elapsedMs; hits entryCount exactly at and beyond durationMs.
 */
export const replayedCountAt = (
  elapsedMs: number,
  durationMs: number,
  entryCount: number,
): number => {
  if (entryCount <= 0) return 0;
  if (durationMs <= 0 || elapsedMs >= durationMs) return entryCount;
  if (elapsedMs <= 0) return 0;
  const eased = easeInOutCubic(elapsedMs / durationMs);
  return Math.min(entryCount, Math.floor(eased * entryCount));
};
