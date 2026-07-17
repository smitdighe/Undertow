import { claimNext, complete, fail, recoverOrphans } from "@/lib/jobs/queue";
import type { ClaimedJob } from "@/lib/jobs/types";

export interface WorkerOptions {
  /** Identifier for logs (defaults to pid). */
  name?: string;
  /** Idle poll interval when the queue is empty. */
  pollMs?: number;
  /** Run the orphan sweep every N polls. */
  orphanSweepEveryPolls?: number;
  /** Exit after this many consecutive empty polls (drain mode). Infinity = run forever. */
  idleExitPolls?: number;
  /** Handle one claimed job. Throwing marks the job failed; the loop survives. */
  processJob: (job: ClaimedJob) => Promise<void>;
}

function log(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: "worker", ...fields }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generic polling worker loop over the job queue.
 *
 * Guarantees:
 * - A throwing processJob marks that job failed and the loop continues — one
 *   poison job cannot kill the worker process.
 * - Even claimNext()/DB errors only log and back off, never crash the loop.
 * - When a job was claimed, the next claim happens immediately (drain fast);
 *   the poll delay only applies when the queue is empty.
 * - SIGINT/SIGTERM stop the loop after the in-flight job finishes.
 */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const {
    name = `worker-${process.pid}`,
    pollMs = 1500,
    orphanSweepEveryPolls = 20,
    idleExitPolls = Infinity,
    processJob,
  } = options;

  let running = true;
  const stop = (signal: string) => {
    log({ worker: name, msg: "stopping", signal });
    running = false;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  log({ worker: name, msg: "started", pollMs });

  let polls = 0;
  let idlePolls = 0;

  while (running) {
    // Periodic orphan sweep (also on first iteration, so a restart after a
    // crash recovers its own orphans immediately).
    if (polls % orphanSweepEveryPolls === 0) {
      try {
        const recovered = await recoverOrphans();
        if (recovered.length > 0) {
          log({ worker: name, msg: "recovered_orphans", ids: recovered });
        }
      } catch (err) {
        log({ worker: name, msg: "orphan_sweep_error", error: String(err) });
      }
    }
    polls++;

    let job = null;
    try {
      job = await claimNext();
    } catch (err) {
      // DB hiccup — log, back off, keep the loop alive.
      log({ worker: name, msg: "claim_error", error: String(err) });
      await sleep(pollMs);
      continue;
    }

    if (!job) {
      idlePolls++;
      if (idlePolls >= idleExitPolls) {
        log({ worker: name, msg: "idle_exit", idlePolls });
        break;
      }
      await sleep(pollMs);
      continue;
    }

    idlePolls = 0;
    const startedAt = Date.now();
    try {
      await processJob(job);
      await complete(job.id);
      log({
        worker: name,
        msg: "job_done",
        jobId: job.id,
        type: job.type,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      // fail() either re-queues (with backoff) or parks as FAILED after
      // MAX_ATTEMPTS. Never rethrow — the loop must survive poison jobs.
      try {
        const result = await fail(job.id);
        log({
          worker: name,
          msg: "job_failed",
          jobId: job.id,
          type: job.type,
          attempts: result?.attempts,
          status: result?.status,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch (failErr) {
        log({
          worker: name,
          msg: "fail_write_error",
          jobId: job.id,
          error: String(failErr),
        });
      }
    }
  }

  log({ worker: name, msg: "stopped" });
}
