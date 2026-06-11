import { describe, expect, test } from "bun:test";
import {
  BUILD_PAYLOAD_LIMIT,
  buildShareUrl,
  fromBase64Url,
  parseAppHash,
  toBase64Url,
} from "../src/io/share";

/** Deterministic pseudo-random bytes via LCG (numerical recipes constants). */
const seededBytes = (length: number, seed: number): Uint8Array => {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
};

describe("base64url roundtrip", () => {
  test("empty buffer", () => {
    expect(toBase64Url(new Uint8Array(0))).toBe("");
    expect(fromBase64Url("")).toEqual(new Uint8Array(0));
  });

  test("1/2/3-byte buffers (padding cases)", () => {
    for (const bytes of [
      new Uint8Array([42]),
      new Uint8Array([42, 7]),
      new Uint8Array([42, 7, 200]),
    ]) {
      const text = toBase64Url(bytes);
      expect(text).not.toContain("=");
      expect(fromBase64Url(text)).toEqual(bytes);
    }
  });

  test("encoded lengths match unpadded base64", () => {
    expect(toBase64Url(new Uint8Array(1)).length).toBe(2);
    expect(toBase64Url(new Uint8Array(2)).length).toBe(3);
    expect(toBase64Url(new Uint8Array(3)).length).toBe(4);
    expect(toBase64Url(new Uint8Array(4)).length).toBe(6);
  });

  test("0x00 and 0xff bytes", () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x00, 0xff, 0xff, 0x00, 0xff]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(new Uint8Array([0xff, 0xff, 0xff]))).toBe("____");
    expect(toBase64Url(new Uint8Array([0x00, 0x00, 0x00]))).toBe("AAAA");
  });

  test("url-safe alphabet for high bytes", () => {
    // 0xfb 0xff would produce "+/" in standard base64; we expect "-_".
    const text = toBase64Url(seededBytes(300, 7));
    expect(text).toMatch(/^[A-Za-z0-9\-_]*$/);
  });

  test("10KB seeded pseudo-random buffer", () => {
    const bytes = seededBytes(10 * 1024, 0xdeadbeef);
    const text = toBase64Url(bytes);
    expect(fromBase64Url(text)).toEqual(bytes);
  });
});

describe("fromBase64Url rejection", () => {
  test("invalid characters", () => {
    for (const bad of ["AB=A", "A+AA", "A/AA", "AB CD", "ABC!", "ÿAAA"]) {
      expect(() => fromBase64Url(bad)).toThrow("share: malformed payload");
    }
  });

  test("bad length (len % 4 === 1)", () => {
    expect(() => fromBase64Url("A")).toThrow("share: malformed payload");
    expect(() => fromBase64Url("AAAAA")).toThrow("share: malformed payload");
  });
});

describe("buildShareUrl", () => {
  test("strips query and old hash", () => {
    const url = buildShareUrl(
      "https://example.com/app/?q=1&x=2#old=hash",
      new Uint8Array([1, 2, 3]),
    );
    expect(url).toBe(`https://example.com/app/#b=${toBase64Url(new Uint8Array([1, 2, 3]))}`);
  });

  test("exact boundary on payload limit", () => {
    // payload length = ceil(n * 4 / 3); n = limit * 3 / 4 bytes encodes to exactly limit chars.
    const atLimit = new Uint8Array((BUILD_PAYLOAD_LIMIT * 3) / 4);
    expect(toBase64Url(atLimit).length).toBe(BUILD_PAYLOAD_LIMIT);
    expect(buildShareUrl("https://example.com/", atLimit)).not.toBeNull();

    const overLimit = new Uint8Array(atLimit.length + 1);
    expect(buildShareUrl("https://example.com/", overLimit)).toBeNull();
  });
});

describe("parseAppHash", () => {
  test("empty and bare hash", () => {
    expect(parseAppHash("")).toEqual({ room: null, build: null });
    expect(parseAppHash("#")).toEqual({ room: null, build: null });
  });

  test("single keys", () => {
    expect(parseAppHash("#r=abc")).toEqual({ room: "abc", build: null });
    expect(parseAppHash("#b=xyz")).toEqual({ room: null, build: "xyz" });
  });

  test("combined and unknown keys", () => {
    expect(parseAppHash("#b=x&r=y")).toEqual({ room: "y", build: "x" });
    expect(parseAppHash("#foo=1&b=p")).toEqual({ room: null, build: "p" });
  });

  test("empty values and missing equals stay null", () => {
    expect(parseAppHash("#b=&r=")).toEqual({ room: null, build: null });
    expect(parseAppHash("#b")).toEqual({ room: null, build: null });
  });
});
