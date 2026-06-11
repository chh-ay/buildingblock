/** Fixed pool of mesher workers; jobs queue to idle workers, transferring buffers both ways. */
import type { MeshDoneMsg, MeshJobMsg } from "../core/types";

export class MesherPool {
  private idle: Worker[] = [];
  private queue: MeshJobMsg[] = [];
  private readonly onDone: (msg: MeshDoneMsg) => void;

  constructor(size: number, onDone: (msg: MeshDoneMsg) => void) {
    this.onDone = onDone;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL("./mesher.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<MeshDoneMsg>) => {
        this.idle.push(worker);
        this.pump();
        this.onDone(event.data);
      };
      this.idle.push(worker);
    }
  }

  /** Jobs accepted but not yet handed to a worker. */
  get pending(): number {
    return this.queue.length;
  }

  submit(job: MeshJobMsg): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const worker = this.idle.pop() as Worker;
      const job = this.queue.shift() as MeshJobMsg;
      worker.postMessage(job, [job.padded.buffer, job.stateTable.buffer, job.stateShapes.buffer]);
    }
  }
}
