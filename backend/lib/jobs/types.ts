import { z } from "zod";
import type { JobStatus, JobType } from "@prisma/client";

export const classifyJobPayloadSchema = z.object({
  incidentId: z.string().min(1),
});
export type ClassifyJobPayload = z.infer<typeof classifyJobPayloadSchema>;

// EVAL job payload mirrors runEval()'s options; every field is optional so an
// empty payload runs the default eval.
export const evalJobPayloadSchema = z.object({
  limit: z.number().int().positive().optional(),
  seedOnly: z.boolean().optional(),
  minTrustworthySample: z.number().int().positive().optional(),
});
export type EvalJobPayload = z.infer<typeof evalJobPayloadSchema>;

export type JobPayloadMap = {
  CLASSIFY: ClassifyJobPayload;
  EVAL: EvalJobPayload;
};

/** Row shape returned by the raw claim query in lib/jobs/queue.ts. */
export interface ClaimedJob {
  id: string;
  type: JobType;
  payload: unknown; // validate with the schema for the job's type before use
  status: JobStatus;
  attempts: number;
  claimedAt: Date | null;
  createdAt: Date;
}
