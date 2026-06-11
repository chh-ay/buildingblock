import { describe, expect, test } from "bun:test";
import {
  EditJournal,
  type JournalEntry,
  replayDurationMs,
  replayedCountAt,
} from "../src/core/journal";

const emptyEntry = (): JournalEntry => ({ x: 0, y: 0, z: 0, key32: 0, shape: 0 });

describe("EditJournal", () => {
  test("pack/unpack roundtrip at extremes", () => {
    const journal = new EditJournal();
    journal.record(383, 127, 383, 0xffffffff, 6);
    journal.record(0, 0, 0, 0, 0);

    const out = emptyEntry();
    journal.entryAt(0, out);
    expect(out).toEqual({ x: 383, y: 127, z: 383, key32: 0xffffffff, shape: 6 });
    journal.entryAt(1, out);
    expect(out).toEqual({ x: 0, y: 0, z: 0, key32: 0, shape: 0 });
  });

  test("order preserved across a segment boundary", () => {
    const journal = new EditJournal();
    const total = 70_000;
    for (let i = 0; i < total; i++) {
      // Derive distinct, in-range fields from i so each entry is identifiable.
      journal.record(i & 383, (i >>> 2) & 127, (i >>> 1) & 383, (i * 2654435761) >>> 0, i % 7);
    }
    expect(journal.length).toBe(total);

    const out = emptyEntry();
    for (const i of [0, 65535, 65536, 69999]) {
      journal.entryAt(i, out);
      expect(out.x).toBe(i & 383);
      expect(out.y).toBe((i >>> 2) & 127);
      expect(out.z).toBe((i >>> 1) & 383);
      expect(out.key32).toBe((i * 2654435761) >>> 0);
      expect(out.shape).toBe(i % 7);
    }
  });

  test("entryAt throws RangeError beyond length", () => {
    const journal = new EditJournal();
    journal.record(1, 2, 3, 4, 5);
    const out = emptyEntry();
    expect(() => journal.entryAt(1, out)).toThrow(RangeError);
    expect(() => journal.entryAt(-1, out)).toThrow(RangeError);
    expect(() => journal.entryAt(0.5, out)).toThrow(RangeError);
  });

  test("reset clears length and overflowed, retains new baseline", () => {
    const journal = new EditJournal(2);
    journal.record(1, 1, 1, 1, 1);
    journal.record(2, 2, 2, 2, 2);
    journal.record(3, 3, 3, 3, 3); // dropped, latches overflow
    expect(journal.length).toBe(2);
    expect(journal.overflowed).toBe(true);
    expect(journal.baseline).toBeNull();

    const baseline = new Uint8Array([7, 8, 9]);
    journal.reset(baseline);
    expect(journal.length).toBe(0);
    expect(journal.overflowed).toBe(false);
    expect(journal.baseline).toBe(baseline);

    journal.reset(null);
    expect(journal.baseline).toBeNull();
  });

  test("overflow latches at tiny capacity and drops subsequent records", () => {
    const journal = new EditJournal(4);
    for (let i = 0; i < 10; i++) journal.record(i, i, i, i, 0);
    expect(journal.length).toBe(4);
    expect(journal.overflowed).toBe(true);

    const out = emptyEntry();
    journal.entryAt(3, out);
    expect(out.x).toBe(3); // entry 4+ never written
    expect(() => journal.entryAt(4, out)).toThrow(RangeError);
  });
});

describe("replayDurationMs", () => {
  test("clamps both ends", () => {
    expect(replayDurationMs(0)).toBe(4000);
    expect(replayDurationMs(100)).toBe(4000); // 300ms raw -> floor clamp
    expect(replayDurationMs(2000)).toBe(6000); // within range: 2000*3
    expect(replayDurationMs(1_000_000)).toBe(22000); // ceiling clamp
  });
});

describe("replayedCountAt", () => {
  test("returns 0 at elapsed 0 and entryCount at/beyond duration", () => {
    expect(replayedCountAt(0, 5000, 1000)).toBe(0);
    expect(replayedCountAt(5000, 5000, 1000)).toBe(1000);
    expect(replayedCountAt(9999, 5000, 1000)).toBe(1000);
    expect(replayedCountAt(0, 5000, 0)).toBe(0);
  });

  test("monotonic over a sweep and bounded by entryCount", () => {
    const duration = 8000;
    const entryCount = 12345;
    let previous = 0;
    for (let elapsed = 0; elapsed <= duration + 500; elapsed += 25) {
      const count = replayedCountAt(elapsed, duration, entryCount);
      expect(count).toBeGreaterThanOrEqual(previous);
      expect(count).toBeLessThanOrEqual(entryCount);
      previous = count;
    }
    expect(previous).toBe(entryCount);
  });
});
