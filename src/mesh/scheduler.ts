/**
 * Tracks dirty chunks, versions them, and remeshes: small edits synchronously on the main
 * thread (zero-latency feedback), bulk work through the worker pool. Stale worker results
 * (older version than the chunk's latest edit) are dropped; the chunk stays queued.
 */
import { buildPadded } from "../core/padded";
import type { ChunkGeometry, ClassTable, MeshDoneMsg } from "../core/types";
import { CHUNK_COUNT, PAD_VOLUME } from "../core/types";
import type { VoxelWorld } from "../core/world";
import { meshChunk } from "./mesher";
import { MesherPool } from "./pool";

/** Shared immutable result for all-air chunks — applied without any meshing work. */
const EMPTY_GEOMETRY: ChunkGeometry = [];

export interface RemeshStats {
  lastMs: number;
  count: number;
  queueDepth: number;
}

export class RemeshScheduler {
  readonly stats: RemeshStats = { lastMs: 0, count: 0, queueDepth: 0 };
  private readonly dirty = new Set<number>();
  private readonly busy = new Set<number>();
  private readonly version = new Uint32Array(CHUNK_COUNT);
  private jobId = 1;
  private readonly pool: MesherPool;
  private readonly world: VoxelWorld;
  private classes: ClassTable;
  private readonly applyGeometry: (ci: number, geo: ChunkGeometry) => void;
  /** Reused padded buffer for synchronous meshes (worker jobs need fresh transferable buffers). */
  private readonly syncPadded = new Uint16Array(PAD_VOLUME);
  /** Reused state-table copies, grown on demand. */
  private stateCache = new Uint32Array(64);
  private shapeCache = new Uint8Array(64);

  constructor(
    world: VoxelWorld,
    classes: ClassTable,
    applyGeometry: (ci: number, geo: ChunkGeometry) => void,
    workerCount: number,
  ) {
    this.world = world;
    this.classes = classes;
    this.applyGeometry = applyGeometry;
    this.pool = new MesherPool(workerCount, (m) => this.onDone(m));
  }

  /** Current material-class table (custom registrations append through setClasses). */
  get classTable(): ClassTable {
    return this.classes;
  }

  /** Swap the class table (custom material registered) and remesh everything. */
  setClasses(t: ClassTable): void {
    this.classes = t;
    this.markAll();
  }

  markDirty(ci: number): void {
    this.version[ci]++;
    this.dirty.add(ci);
  }

  markAll(): void {
    for (let ci = 0; ci < CHUNK_COUNT; ci++) this.markDirty(ci);
  }

  /**
   * Per-frame drain: when only a handful of chunks are dirty and nothing is in flight,
   * mesh them inline this frame; otherwise feed the workers.
   */
  flush(syncBudget = 3): void {
    if (this.dirty.size > 0) {
      if (this.dirty.size <= syncBudget && this.busy.size === 0) {
        for (const ci of [...this.dirty]) this.meshNow(ci);
      } else {
        this.pump();
      }
    }
    this.stats.queueDepth = this.dirty.size + this.busy.size;
  }

  /** Mesh one chunk synchronously on the main thread. Null chunks clear instantly. */
  meshNow(ci: number): void {
    this.dirty.delete(ci);
    if (this.world.chunks[ci] === null) {
      this.applyGeometry(ci, EMPTY_GEOMETRY);
      return;
    }
    const version = this.version[ci];
    const start = performance.now();
    const geo = meshChunk(
      buildPadded(this.world, ci, this.syncPadded),
      this.syncStates(),
      this.syncShapes(),
      this.classes.opaque,
      this.classes.bucket,
      this.classes.gloss,
      this.classes.emissive,
    );
    this.stats.lastMs = performance.now() - start;
    this.stats.count++;
    if (version === this.version[ci]) this.applyGeometry(ci, geo);
  }

  private pump(): void {
    for (const ci of this.dirty) {
      if (this.busy.has(ci)) continue;
      this.dirty.delete(ci);
      if (this.world.chunks[ci] === null) {
        this.applyGeometry(ci, EMPTY_GEOMETRY);
        continue;
      }
      this.busy.add(ci);
      this.pool.submit({
        jobId: this.jobId++,
        ci,
        version: this.version[ci],
        padded: buildPadded(this.world, ci),
        stateTable: this.syncStates().slice(),
        stateShapes: this.syncShapes().slice(),
        classOpaque: this.classes.opaque,
        classBucket: this.classes.bucket,
        classGloss: this.classes.gloss,
        classEmissive: this.classes.emissive,
      });
    }
  }

  /** Refresh the reused state-table copy (append-only in practice; full copy is sub-µs). */
  private syncStates(): Uint32Array {
    const table = this.world.stateTable;
    if (table.length > this.stateCache.length) {
      let capacity = this.stateCache.length;
      while (capacity < table.length) capacity <<= 1;
      this.stateCache = new Uint32Array(capacity);
    }
    for (let i = 0; i < table.length; i++) this.stateCache[i] = table[i];
    return this.stateCache.subarray(0, table.length);
  }

  /** Refresh the reused shape-table copy, parallel to syncStates. */
  private syncShapes(): Uint8Array {
    const shapes = this.world.stateShapes;
    if (shapes.length > this.shapeCache.length) {
      let capacity = this.shapeCache.length;
      while (capacity < shapes.length) capacity <<= 1;
      this.shapeCache = new Uint8Array(capacity);
    }
    for (let i = 0; i < shapes.length; i++) this.shapeCache[i] = shapes[i];
    return this.shapeCache.subarray(0, shapes.length);
  }

  private onDone(m: MeshDoneMsg): void {
    this.busy.delete(m.ci);
    this.stats.lastMs = m.ms;
    this.stats.count++;
    if (m.version === this.version[m.ci]) this.applyGeometry(m.ci, m.buckets);
  }
}
