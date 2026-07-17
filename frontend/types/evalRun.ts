// EvalRun shapes. Grounded in backend/prisma/schema.prisma model EvalRun.
import { z } from "zod";

export const evalRunSchema = z.object({
  id: z.string(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  sampleSize: z.number().int(),
  driftFlag: z.boolean(),
  createdAt: z.string(),
});

export type EvalRun = z.infer<typeof evalRunSchema>;

/**
 * Contract for GET /api/eval-runs?limit=&cursor=.
 *
 * This route DOES NOT EXIST on the backend yet — it is a documented, agreed shape,
 * not an observed one. Unlike every other schema here, it could not be validated
 * against a real response. Callers must treat a 404 as an expected outcome; see
 * listEvalRuns in lib/api/evalRuns.ts.
 */
export const evalRunsPageSchema = z.object({
  runs: z.array(evalRunSchema),
  nextCursor: z.string().nullable(),
});

export type EvalRunsPage = z.infer<typeof evalRunsPageSchema>;
