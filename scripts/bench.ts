/** Mesher benchmark: bun run scripts/bench.ts */
import { builtinClassTable, MaterialClass, PAD_VOLUME, packState, pIndex } from "../src/core/types";
import { meshChunk } from "../src/mesh/mesher";

const classes = builtinClassTable();
const stateTable = Uint32Array.of(
  0,
  packState(MaterialClass.Matte, 0xd94f3d),
  packState(MaterialClass.Matte, 0x3f6fc4),
  packState(MaterialClass.Gloss, 0xf4f4f0),
  packState(MaterialClass.Emissive, 0xffd9a0),
  packState(MaterialClass.Glass, 0x9fd9ec),
);

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Fill = (x: number, y: number, z: number) => number;

const makePadded = (fill: Fill): Uint16Array => {
  const p = new Uint16Array(PAD_VOLUME);
  for (let y = 0; y < 32; y++)
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) p[pIndex(x, y, z)] = fill(x, y, z);
  return p;
};

const rng = mulberry32(1234);
const cases: Record<string, Uint16Array> = {
  empty: makePadded(() => 0),
  solid: makePadded(() => 1),
  terrain: makePadded((x, y, z) =>
    y < 8 + 6 * Math.sin(x / 5) * Math.cos(z / 7) ? ((x ^ z) & 1 ? 1 : 2) : 0,
  ),
  "random 30%": makePadded(() => (rng() < 0.3 ? 1 + Math.floor(rng() * 5) : 0)),
  checkerboard: makePadded((x, y, z) => ((x + y + z) & 1 ? 1 : 0)),
};

const ITER = 50;
console.log(`mesher benchmark — ${ITER} iterations per case`);
for (const [name, padded] of Object.entries(cases)) {
  // warmup
  for (let i = 0; i < 5; i++)
    meshChunk(
      padded,
      stateTable,
      new Uint8Array(stateTable.length),
      classes.opaque,
      classes.bucket,
      classes.gloss,
      classes.emissive,
    );
  const t0 = performance.now();
  let verts = 0;
  for (let i = 0; i < ITER; i++) {
    const geo = meshChunk(
      padded,
      stateTable,
      new Uint8Array(stateTable.length),
      classes.opaque,
      classes.bucket,
      classes.gloss,
      classes.emissive,
    );
    verts = geo.reduce((n, b) => n + (b ? b.vertexCount : 0), 0);
  }
  const ms = (performance.now() - t0) / ITER;
  console.log(
    `${name.padEnd(14)} ${ms.toFixed(3).padStart(8)} ms/chunk   ${String(verts).padStart(7)} verts`,
  );
}
