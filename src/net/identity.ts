/**
 * Deterministic peer identity: every client derives the same name and color from a
 * peer id, so presence costs zero wire bytes. Stylized, not unique — collisions are
 * harmless (two "Coral Fox" peers still have distinct ids and nearby hues).
 */

export interface PeerIdentity {
  name: string;
  /** CSS color for labels/chips. */
  cssColor: string;
  /** 0xRRGGBB for three.js materials. */
  hexColor: number;
}

const TONES = [
  "Coral",
  "Mint",
  "Amber",
  "Cobalt",
  "Lilac",
  "Moss",
  "Rust",
  "Pearl",
  "Jade",
  "Ember",
  "Frost",
  "Sage",
  "Plum",
  "Dune",
  "Onyx",
  "Fawn",
];

const ANIMALS = [
  "Fox",
  "Otter",
  "Lynx",
  "Heron",
  "Mole",
  "Wren",
  "Newt",
  "Ibex",
  "Koi",
  "Crow",
  "Hare",
  "Seal",
  "Toad",
  "Swift",
  "Vole",
  "Pika",
];

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
};

const hslChannel = (p: number, q: number, t: number): number => {
  let h = t;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h < 1 / 6) return p + (q - p) * 6 * h;
  if (h < 1 / 2) return q;
  if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
  return p;
};

const hslToHex = (hue: number, saturation: number, lightness: number): number => {
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const r = Math.round(hslChannel(p, q, hue + 1 / 3) * 255);
  const g = Math.round(hslChannel(p, q, hue) * 255);
  const b = Math.round(hslChannel(p, q, hue - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
};

export const derivePeerIdentity = (peerId: string): PeerIdentity => {
  const hash = fnv1a(peerId);
  const name = `${TONES[hash & 15]} ${ANIMALS[(hash >>> 4) & 15]}`;
  const hue = (hash >>> 8) % 360;
  return {
    name,
    cssColor: `hsl(${hue} 70% 62%)`,
    hexColor: hslToHex(hue / 360, 0.7, 0.62),
  };
};
