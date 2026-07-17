import { prisma } from "@/lib/prisma";
import {
  classifyJobPayloadSchema,
  evalJobPayloadSchema,
  type ClaimedJob,
} from "@/lib/jobs/types";
import { classify } from "@/lib/llm/router";
import { publishIncident } from "@/lib/sse/bus";
import { runEval } from "@/lib/eval/runner";

/**
 * Process a CLASSIFY job: load the incident, run the LLM router, write the
 * classification back onto the Incident row. Throws on any failure — the
 * worker loop translates that into fail(jobId) (retry, then FAILED = flagged
 * for manual review).
 */
async function processClassify(job: ClaimedJob): Promise<void> {
  const { incidentId } = classifyJobPayloadSchema.parse(job.payload);

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
  });
  if (!incident) {
    throw new Error(`incident ${incidentId} not found`);
  }

  const { data, provider } = await classify(incident.title, incident.body);

  await prisma.incident.update({
    where: { id: incidentId },
    data: {
      severity: data.severity,
      suggestedTeam: data.suggestedTeam,
      draftResponse: data.draftResponse,
    },
  });

  console.info(
    JSON.stringify({
      event: "incident.classified",
      incidentId,
      provider,
      severity: data.severity,
      suggestedTeam: data.suggestedTeam,
    })
  );

  // Notify the web process so the dashboard gets the classified incident live.
  await publishIncident(incidentId);
}

/**
 * Process an EVAL job: run the same runEval() the CLI uses, and record a
 * summary on the job so an async caller can poll the job id for the result.
 * Throws on failure — the worker turns that into fail(jobId) with the standard
 * retry/backoff, then FAILED after MAX_ATTEMPTS.
 */
async function processEval(job: ClaimedJob): Promise<void> {
  const options = evalJobPayloadSchema.parse(job.payload ?? {});
  const result = await runEval(options);

  // Written before complete() so a DONE job always has its result available.
  await prisma.job.update({
    where: { id: job.id },
    data: {
      result: {
        evalRunId: result.evalRunId,
        written: result.written,
        sampleSize: result.sampleSize,
        effectiveSampleSize: result.effectiveSampleSize,
        lowSample: result.lowSample,
        sampleBelowTrustThreshold: result.sampleBelowTrustThreshold,
        aggregate: {
          precision: result.aggregate.precision,
          recall: result.aggregate.recall,
          f1: result.aggregate.f1,
        },
        // Spread into plain object literals: Prisma's Json input type rejects
        // interfaces (no implicit index signature).
        drift: { ...result.drift },
        judge: { ...result.judge },
        classifyFailures: result.classifyFailures,
      },
    },
  });

  console.info(
    JSON.stringify({
      event: "eval.job_complete",
      jobId: job.id,
      evalRunId: result.evalRunId,
      sampleSize: result.sampleSize,
      f1: result.aggregate.f1,
      driftFlag: result.drift.driftFlag,
    })
  );
}

/** Dispatch one claimed job to its handler. */
export async function processJob(job: ClaimedJob): Promise<void> {
  switch (job.type) {
    case "CLASSIFY":
      return processClassify(job);
    case "EVAL":
      return processEval(job);
    default:
      throw new Error(`unknown job type: ${String(job.type)}`);
  }
}
