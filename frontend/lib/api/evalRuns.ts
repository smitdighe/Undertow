// Eval trigger, job poll, and the (not-yet-existing) eval-run history list.
import { apiFetch, isNotFound } from "./client";
import { pollUntil, type PollOptions } from "./poll";
import { evalRunsPageSchema, type EvalRunsPage } from "@/types/evalRun";
import {
  evalTriggerSchema,
  evalJobStatusSchema,
  type EvalTrigger,
  type EvalJobStatus,
} from "@/types/job";

const CRON_HEADER = "x-cron-secret";

/**
 * The cron routes authenticate with CRON_SHARED_SECRET. That secret is
 * backend-only and MUST NOT be bundled into client code — a NEXT_PUBLIC_ copy
 * would be readable by anyone who opens devtools and would let them trigger
 * evals and read scores, which the backend deliberately gates.
 *
 * These functions therefore refuse to run in a browser. Call them from a route
 * handler, server action, or script, where process.env.CRON_SHARED_SECRET is safe
 * to read. This is a guard against accidental misuse, not a substitute for keeping
 * the secret out of the client bundle.
 */
function assertServerOnly(fn: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${fn} is server-only: it sends the cron shared secret, which must never reach the browser.`
    );
  }
}

/**
 * POST /api/cron/eval — enqueues an EVAL job, returns 202 immediately.
 *
 * The 202 does NOT contain eval results. It carries a jobId; the eval runs
 * asynchronously in the worker and takes minutes. Poll with pollEvalJob.
 */
export async function triggerEval(
  secret: string,
  signal?: AbortSignal
): Promise<EvalTrigger> {
  assertServerOnly("triggerEval");
  return apiFetch("/api/cron/eval", {
    schema: evalTriggerSchema,
    method: "POST",
    headers: { [CRON_HEADER]: secret },
    signal,
  });
}

/** GET /api/cron/eval/[jobId] — one status read. Throws ApiError 401 on a bad secret, 404 if unknown. */
export async function getEvalJob(
  jobId: string,
  secret: string,
  signal?: AbortSignal
): Promise<EvalJobStatus> {
  assertServerOnly("getEvalJob");
  return apiFetch(`/api/cron/eval/${encodeURIComponent(jobId)}`, {
    schema: evalJobStatusSchema,
    headers: { [CRON_HEADER]: secret },
    signal,
  });
}

/** The job reached a terminal FAILED state. Distinct from "still pending" (PollTimeoutError). */
export class EvalJobFailedError extends Error {
  constructor(public job: EvalJobStatus) {
    super(`Eval job ${job.jobId} failed after ${job.attempts} attempt(s).`);
    this.name = "EvalJobFailedError";
  }
}

/** DONE, but no EvalRun was recorded — a worker contract break, not a normal outcome. */
export class EvalRunMissingError extends Error {
  constructor(public job: EvalJobStatus) {
    super(`Eval job ${job.jobId} finished without recording an EvalRun.`);
    this.name = "EvalRunMissingError";
  }
}

/**
 * Poll an eval job to completion and return the EvalRun it produced.
 *
 * Three distinct outcomes, deliberately not collapsed:
 *  - resolves with the EvalRun                 -> DONE
 *  - throws EvalJobFailedError                 -> terminal FAILED, retrying is pointless
 *  - throws PollTimeoutError (from pollUntil)  -> STILL PENDING, the job may yet finish
 *
 * Defaults suit a minutes-long eval: 12 attempts, 1s doubling to 8s (~50s total).
 */
export async function pollEvalJob(
  jobId: string,
  secret: string,
  options: PollOptions = {}
) {
  assertServerOnly("pollEvalJob");

  const job = await pollUntil(
    () => getEvalJob(jobId, secret, options.signal),
    // `done` is true for DONE *and* FAILED — stop on either, then disambiguate.
    (j) => j.done,
    { maxAttempts: 12, initialDelayMs: 1000, maxDelayMs: 8000, ...options }
  );

  if (job.status === "FAILED") throw new EvalJobFailedError(job);
  if (!job.evalRun) throw new EvalRunMissingError(job);

  return { job, evalRun: job.evalRun };
}

export interface ListEvalRunsParams {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/**
 * GET /api/eval-runs?limit=&cursor= — history list.
 *
 * THIS ROUTE DOES NOT EXIST YET. It is built to an agreed contract and will 404
 * until the backend ships it. Callers MUST handle that: use listEvalRunsOrNull,
 * or catch and test with isNotFound. Do not assume availability.
 */
export async function listEvalRuns(
  params: ListEvalRunsParams = {}
): Promise<EvalRunsPage> {
  const { limit, cursor, signal } = params;
  return apiFetch("/api/eval-runs", {
    schema: evalRunsPageSchema,
    query: { limit, cursor },
    signal,
  });
}

/**
 * listEvalRuns, but a 404 resolves to null instead of throwing — "the backend
 * hasn't shipped this yet" is an expected state, not an error. Every other
 * failure (401, 500, network, schema) still throws, so real problems stay loud.
 */
export async function listEvalRunsOrNull(
  params: ListEvalRunsParams = {}
): Promise<EvalRunsPage | null> {
  try {
    return await listEvalRuns(params);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
