/** Worker wrapper around the pure mesher: one MeshJobMsg in, one MeshDoneMsg out (buffers transferred). */
import type { MeshDoneMsg, MeshJobMsg } from "../core/types";
import { meshChunk } from "./mesher";

interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
}

self.addEventListener("message", (e: MessageEvent<MeshJobMsg>) => {
  const j = e.data;
  const t0 = performance.now();
  const buckets = meshChunk(
    j.padded,
    j.stateTable,
    j.stateShapes,
    j.classOpaque,
    j.classBucket,
    j.classGloss,
    j.classEmissive,
  );
  const msg: MeshDoneMsg = {
    jobId: j.jobId,
    ci: j.ci,
    version: j.version,
    buckets,
    ms: performance.now() - t0,
  };
  const transfer: Transferable[] = [];
  for (const b of buckets) {
    if (b) {
      transfer.push(
        b.position.buffer,
        b.normal.buffer,
        b.color.buffer,
        b.extra.buffer,
        b.index.buffer,
      );
    }
  }
  (self as unknown as WorkerScope).postMessage(msg, transfer);
});
