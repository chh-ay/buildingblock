/** Max characters allowed for the #b= payload; beyond this links get unwieldy in chat apps. */
export const BUILD_PAYLOAD_LIMIT = 65536;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Char code → 6-bit value; -1 marks chars outside the alphabet.
const DECODE_TABLE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) {
  DECODE_TABLE[ALPHABET.charCodeAt(i)] = i;
}

export const toBase64Url = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  const fullGroups = bytes.length - (bytes.length % 3);
  let i = 0;
  for (; i < fullGroups; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    parts.push(
      ALPHABET[(triple >> 18) & 63],
      ALPHABET[(triple >> 12) & 63],
      ALPHABET[(triple >> 6) & 63],
      ALPHABET[triple & 63],
    );
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const triple = bytes[i] << 16;
    parts.push(ALPHABET[(triple >> 18) & 63], ALPHABET[(triple >> 12) & 63]);
  } else if (rest === 2) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8);
    parts.push(
      ALPHABET[(triple >> 18) & 63],
      ALPHABET[(triple >> 12) & 63],
      ALPHABET[(triple >> 6) & 63],
    );
  }
  return parts.join("");
};

export const fromBase64Url = (text: string): Uint8Array => {
  if (text.length % 4 === 1) throw new Error("share: malformed payload");
  const byteLength = (text.length * 3) >> 2;
  const out = new Uint8Array(byteLength);
  let bits = 0;
  let bitCount = 0;
  let outIndex = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? DECODE_TABLE[code] : -1;
    if (value < 0) throw new Error("share: malformed payload");
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[outIndex++] = (bits >> bitCount) & 0xff;
    }
  }
  return out;
};

/** origin+pathname of href + "#b=" + payload; null when payload exceeds BUILD_PAYLOAD_LIMIT. */
export const buildShareUrl = (href: string, gzBytes: Uint8Array): string | null => {
  const payload = toBase64Url(gzBytes);
  if (payload.length > BUILD_PAYLOAD_LIMIT) return null;
  const url = new URL(href);
  return `${url.origin}${url.pathname}#b=${payload}`;
};

/** Parse a location.hash like "#b=...", "#r=...", "#b=...&r=..."; unknown keys ignored. */
export const parseAppHash = (hash: string): { room: string | null; build: string | null } => {
  let room: string | null = null;
  let build: string | null = null;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === "") continue;
    if (key === "r") room = value;
    else if (key === "b") build = value;
  }
  return { room, build };
};
