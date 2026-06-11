/**
 * Tool implementations for the interact layer: rect-drag gesture state machines
 * (place / erase / paint / box) plus the eyedropper, built on the api.ts contracts.
 */

import type { RayHit } from "../core/types";
import { AIR, FACE_NORMAL, inWorld, WORLD_SX, WORLD_SY, WORLD_SZ } from "../core/types";
import type { ToolId } from "../state";
import type { EditSession, Ray, Tool, ToolEnv, ToolPointer } from "./api";

const DIM = Int32Array.of(WORLD_SX, WORLD_SY, WORLD_SZ);

const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Cell adjacent to a hit along its face normal; ground hits map to the baseplate cell at y=0. */
export const adjacentCell = (hit: RayHit): [number, number, number] => {
  if (hit.ground) return [hit.x, 0, hit.z];
  const f = hit.face * 3;
  return [hit.x + FACE_NORMAL[f], hit.y + FACE_NORMAL[f + 1], hit.z + FACE_NORMAL[f + 2]];
};

/**
 * Intersect a ray with the cell-center plane `planeCellCoord + 0.5` along `axis`;
 * writes the floored cell into `out` (axis component forced exact). False when
 * the ray is parallel or the plane lies behind the origin.
 */
export const rayPlaneCell = (
  ray: Ray,
  axis: 0 | 1 | 2,
  planeCellCoord: number,
  out: [number, number, number],
): boolean => {
  const o = axis === 0 ? ray.ox : axis === 1 ? ray.oy : ray.oz;
  const d = axis === 0 ? ray.dx : axis === 1 ? ray.dy : ray.dz;
  if (Math.abs(d) < 1e-8) return false;
  const t = (planeCellCoord + 0.5 - o) / d;
  if (t <= 0) return false;
  out[0] = Math.floor(ray.ox + t * ray.dx);
  out[1] = Math.floor(ray.oy + t * ray.dy);
  out[2] = Math.floor(ray.oz + t * ray.dz);
  out[axis] = planeCellCoord;
  return true;
};

interface RectOpts {
  adjacent: boolean;
  allowGround: boolean;
  wantAir: boolean;
  toAir: boolean;
  box: boolean;
  /** Apply the anchor cell immediately on pointerdown (tap = instant block). */
  instant: boolean;
}

/** Shared rect-drag gesture: place/erase/paint are one layer, box stacks h layers. */
const createRectTool = (opts: RectOpts): Tool => {
  let active = false;
  let axis: 0 | 1 | 2 = 1;
  let sign = 1;
  let h = 1;
  let count = 0;
  let buf = new Int32Array(192);
  let session: EditSession | null = null;
  const anchor = new Int32Array(3);
  const target: [number, number, number] = [0, 0, 0];
  const cell = new Int32Array(3);

  const recompute = (env: ToolEnv): void => {
    const world = env.world;
    const u = ((axis + 1) % 3) as 0 | 1 | 2;
    const v = ((axis + 2) % 3) as 0 | 1 | 2;
    const u0 = Math.min(anchor[u], target[u]);
    const u1 = Math.max(anchor[u], target[u]);
    const v0 = Math.min(anchor[v], target[v]);
    const v1 = Math.max(anchor[v], target[v]);
    const layers = opts.box ? h : 1;
    const need = (u1 - u0 + 1) * (v1 - v0 + 1) * layers * 3;
    if (buf.length < need) {
      let cap = buf.length;
      while (cap < need) cap <<= 1;
      buf = new Int32Array(cap);
    }
    let n = 0;
    const wantAir = opts.wantAir;
    for (let layer = 0; layer < layers; layer++) {
      cell[axis] = anchor[axis] + layer * sign;
      for (let cu = u0; cu <= u1; cu++) {
        cell[u] = cu;
        for (let cv = v0; cv <= v1; cv++) {
          cell[v] = cv;
          const x = cell[0];
          const y = cell[1];
          const z = cell[2];
          if (!inWorld(x, y, z)) continue;
          if ((world.get(x, y, z) === AIR) !== wantAir) continue;
          buf[n] = x;
          buf[n + 1] = y;
          buf[n + 2] = z;
          n += 3;
        }
      }
    }
    count = n / 3;
    env.ghosts(buf, count);
  };

  return {
    down(p: ToolPointer, env: ToolEnv): void {
      const hit = p.hit;
      if (!hit || (!opts.allowGround && hit.ground)) return;
      if (opts.adjacent) {
        const a = adjacentCell(hit);
        anchor[0] = a[0];
        anchor[1] = a[1];
        anchor[2] = a[2];
      } else {
        anchor[0] = hit.x;
        anchor[1] = hit.y;
        anchor[2] = hit.z;
      }
      axis = (hit.face >> 1) as 0 | 1 | 2;
      sign = hit.face & 1 ? -1 : 1;
      h = 1;
      target[0] = anchor[0];
      target[1] = anchor[1];
      target[2] = anchor[2];
      active = true;
      if (opts.instant) {
        // Instant anchor: the first cell lands on pointerdown for tactile feedback;
        // dragging extends the rect as a ghost preview committed on release.
        session = env.begin();
        const value = opts.toAir ? AIR : env.state();
        const air = env.world.get(anchor[0], anchor[1], anchor[2]) === AIR;
        if (air === opts.wantAir) session.set(anchor[0], anchor[1], anchor[2], value);
      }
      env.hover(null);
      recompute(env);
    },
    move(p: ToolPointer, env: ToolEnv): void {
      if (!active) return;
      if (rayPlaneCell(p.ray, axis, anchor[axis], target)) {
        const u = (axis + 1) % 3;
        const v = (axis + 2) % 3;
        target[u] = clampInt(target[u], 0, DIM[u] - 1);
        target[v] = clampInt(target[v], 0, DIM[v] - 1);
      }
      recompute(env);
    },
    up(_p: ToolPointer, env: ToolEnv): void {
      if (!active) return;
      active = false;
      const value = opts.toAir ? AIR : env.state();
      const gestureSession = session ?? env.begin();
      session = null;
      const end = count * 3;
      for (let i = 0; i < end; i += 3) gestureSession.set(buf[i], buf[i + 1], buf[i + 2], value);
      gestureSession.commit();
      env.ghosts(null);
      count = 0;
    },
    wheel(deltaY: number, env: ToolEnv): boolean {
      if (!opts.box || !active) return false;
      h = clampInt(h + (deltaY < 0 ? 1 : -1), 1, 64);
      recompute(env);
      return true;
    },
    hover(p: ToolPointer, env: ToolEnv): void {
      if (!active) env.hover(p.hit);
    },
    cancel(env: ToolEnv): void {
      session?.cancel();
      session = null;
      active = false;
      count = 0;
      h = 1;
      env.ghosts(null);
    },
  };
};

/** Eyedropper: reads the hit voxel's state on down; no gesture, no session. */
const createPickTool = (): Tool => ({
  down(p: ToolPointer, env: ToolEnv): void {
    const hit = p.hit;
    if (hit && !hit.ground) env.pick(env.world.get(hit.x, hit.y, hit.z));
  },
  move(): void {},
  up(): void {},
  wheel(): boolean {
    return false;
  },
  hover(p: ToolPointer, env: ToolEnv): void {
    env.hover(p.hit);
  },
  cancel(env: ToolEnv): void {
    env.ghosts(null);
  },
});

/** Fresh tool instances with independent gesture state, keyed by ToolId. */
export const createTools = (): Record<ToolId, Tool> => ({
  place: createRectTool({
    adjacent: true,
    allowGround: true,
    wantAir: true,
    toAir: false,
    box: false,
    instant: true,
  }),
  erase: createRectTool({
    adjacent: false,
    allowGround: false,
    wantAir: false,
    toAir: true,
    box: false,
    instant: true,
  }),
  paint: createRectTool({
    adjacent: false,
    allowGround: false,
    wantAir: false,
    toAir: false,
    box: false,
    instant: true,
  }),
  box: createRectTool({
    adjacent: true,
    allowGround: true,
    wantAir: true,
    toAir: false,
    box: true,
    instant: false,
  }),
  pick: createPickTool(),
});
