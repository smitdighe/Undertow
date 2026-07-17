// Job shapes. Grounded in backend/prisma/schema.prisma and the two cron routes.
import { z } from "zod";
import { evalRunSchema } from "./evalRun";

export const JOB_TYPES = ["CLASSIFY", "EVAL"] as const;
export const JOB_STATUSES = ["PENDING", "CLAIMED", "DONE", "FAILED"] as const;

export const jobTypeSchema = z.enum(JOB_TYPES);
export const jobStatusSchema = z.enum(JOB_STATUSES);

/** 202 body from POST /api/cron/eval. The eval itself has NOT run yet. */
export const evalTriggerSchema = z.object({
  ok: z.literal(true),
  jobId: z.string(),
  status: jobStatusSchema,
  statusUrl: z.string(),
});

/**
 * GET /api/cron/eval/[jobId].
 *
 * Deliberately not modelled as a Job row: the route returns `jobId` (not `id`),
 * omits `type`/`payload`, and adds `done` plus the joined EvalRun. Modelling the
 * Prisma row here would be inventing a shape the transport never sends.
 *
 * `evalRun` is null until the worker finishes and records one; `result` is the
 * handler's opaque JSON, left as unknown rather than cast — the route already
 * surfaces the EvalRun separately, so nothing needs to reach into it.
 */
export const evalJobStatusSchema = z.object({
  jobId: z.string(),
  status: jobStatusSchema,
  // True for DONE *or* FAILED — a terminal-state flag, not a success flag.
  done: z.boolean(),
  attempts: z.number().int(),
  createdAt: z.string(),
  claimedAt: z.string().nullable(),
  result: z.unknown().nullable(),
  evalRun: evalRunSchema.nullable(),
});

export type JobType = z.infer<typeof jobTypeSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type EvalTrigger = z.infer<typeof evalTriggerSchema>;
export type EvalJobStatus = z.infer<typeof evalJobStatusSchema>;
