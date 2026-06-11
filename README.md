# buildingblock

Voxel building sandbox in the browser. **[Try it](https://chh-ay.github.io/buildingblock/)** — no install, no account.

![buildingblock](public/og.png)

Place, erase and paint blocks (cubes, slabs, ramps), drag out rectangles, undo freely. Every edit gets journaled, so you can hit Replay and watch your build reassemble itself brick by brick. When you like what you made, copy a build link — the whole world is gzipped into the URL itself, nothing gets uploaded anywhere. There's also a live mode: a Share link puts you and your friends in the same world over WebRTC, no server involved, with little colored cursors showing who's poking where.

The Gallery has a few scenes to start from:

| | | |
|:---:|:---:|:---:|
| ![Harbor Lighthouse](public/gallery/harbor-lighthouse.png) | ![Sky Temple](public/gallery/sky-temple.png) | ![Castle Keep](public/gallery/castle-keep.png) |
| ![Sail Ship](public/gallery/sail-ship.png) | ![Winter Cabin](public/gallery/winter-cabin.png) | ![Neon Alley](public/gallery/neon-city.png) |

Other bits: a day/night cycle synced to your clock, IndexedDB autosave plus named saves, `.bbk.gz` world files, MagicaVoxel `.vox` in/out, `.glb` export, and tiny synthesized click sounds (no audio files, it's all oscillators).

## Running it

```sh
bun install
bun run dev
```

`bun test`, `bun run check` (tsc) and `bun run lint` (biome) are the gates. `bun run gallery` rebuilds the bundled scenes from `scripts/gallery/scenes/`.

## How it's built

Rendering is three.js WebGPU with TSL node materials, falling back to WebGL2 where WebGPU isn't available. Chunks are 32³ with palette-compressed storage; meshing is a binary greedy mesher (bitmask set algebra, baked ambient occlusion) that does a terrain chunk in about half a millisecond and runs in a worker pool, with a synchronous path so single-block edits never feel laggy. Shadows only re-render when something changes. The whole UI is vanilla DOM on top of a ~25-line signal store.

Layout, roughly: `src/core` is the world and pure logic, `src/mesh` the mesher, `src/render` everything three.js touches, `src/interact` tools and input, `src/net` the P2P room, `src/io` codecs and saves, `src/ui` panels and menus. The perf HUD lives in Settings if you want to watch the numbers.

Desktop and tablet only.
