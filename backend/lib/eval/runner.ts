import { prisma } from "@/lib/prisma";
import { classify } from "@/lib/llm/router";
import { embed } from "@/lib/embeddings";
import { findDuplicate } from "@/lib/dedupe";
import { judgeClassification } from "@/lib/llm/gemini";
import {
  aggregate,
  detectDrift,
  isAdjacentSeverity,
  macroMetrics,
  type FieldMetrics,
  type Sample,
} from "@/lib/eval/metrics";
import type { JudgeField } from "@/lib/llm/prompts/judge";

export const DEFAULT_LIMIT = 100;
export const ROLLING_WINDOW = 5;
export const DRIFT_THRESHOLD = 0.05; // relative F1 drop
/**
 * Below this many ground-truth incidents, driftFlag is statistical noise and
 * must not be trusted as a merge gate. Callers (CI) should fail loudly rather
 * than pass on a tiny/empty sample.
 */
export const MIN_TRUSTWORTHY_SAMPLE = 10;
const NONE = "none"; // negative label for the duplicate field

export interface JudgeCounters {
  judged: number;
  judgeCredited: number;
  judgeFailed: number;
}

export interface EvalResult {
  evalRunId: string | null;
  /** False when there was no ground truth to score, so no row was written. */
  written: boolean;
  /** Incidents pulled as ground truth. */
  sampleSize: number;
  /**
   * Incidents actually scored (pulled minus classify() failures). Provider
   * outages/rate limits can make this much smaller than sampleSize — metrics
   * from such a run are noise, and this is what the trust threshold checks.
   */
  effectiveSampleSize: number;
  lowSample: boolean;
  /** True when too few incidents were scored for driftFlag to mean anything. */
  sampleBelowTrustThreshold: boolean;
  fields: { severity: FieldMetrics; team: FieldMetrics; duplicate: FieldMetrics };
  aggregate: FieldMetrics;
  judge: JudgeCounters;
  classifyFailures: number;
  drift: {
    driftFlag: boolean;
    rollingAvg: number | null;
    relativeDrop: number | null;
    historyRuns: number;
  };
}

export interface RunEvalOptions {
  limit?: number;
  /** Restrict to seeded ground-truth incidents (source="seed"). */
  seedOnly?: boolean;
  minTrustworthySample?: number;
  /**
   * Delay between incidents (ms). The eval is a batch job where latency is
   * irrelevant but provider RPM limits are real: an unpaced run over the
   * default 100 incidents reliably trips free-tier 429s and degrades the run.
   * Defaults to EVAL_PACE_MS env or 0.
   */
  paceMs?: number;
}

/**
 * Decide whether a prediction counts as correct. Strict equality first; for
 * borderline disagreements ask Gemini as an independent judge instead of a
 * blunt string-equality fail. If the judge errors, fall back to strict (the
 * case scores as a mismatch) rather than failing the whole run.
 */
async function isMatch(
  field: JudgeField,
  predicted: string,
  actual: string,
  incident: { title: string; body: string },
  counters: JudgeCounters
): Promise<boolean> {
  if (predicted === actual) return true;

  const borderline =
    field === "severity"
      ? isAdjacentSeverity(predicted, actual)
      : field === "team"
        ? predicted !== NONE && actual !== NONE // free-form names: any mismatch is arguable
        : false; // duplicate: an id either matches or it doesn't

  if (!borderline) return false;

  counters.judged++;
  try {
    const verdict = await judgeClassification({
      title: incident.title,
      body: incident.body,
      field,
      classifierValue: predicted,
      correctedValue: actual,
    });
    if (verdict.reasonable) counters.judgeCredited++;
    return verdict.reasonable;
  } catch (err) {
    counters.judgeFailed++;
    console.warn(
      JSON.stringify({
        event: "eval.judge_failed",
        field,
        reason: err instanceof Error ? err.message : String(err),
        action: "fallback_to_strict",
      })
    );
    return false;
  }
}

/**
 * Run the eval: re-run the production classify() pipeline against incidents
 * carrying human corrections (ground truth), score per field, persist an
 * EvalRun row, and flag drift against the rolling average.
 *
 * Does not manage the Prisma connection — callers (script vs route) own that.
 */
export async function runEval(options: RunEvalOptions = {}): Promise<EvalResult> {
  const {
    limit = DEFAULT_LIMIT,
    seedOnly = false,
    minTrustworthySample = MIN_TRUSTWORTHY_SAMPLE,
    paceMs = Number(process.env.EVAL_PACE_MS ?? 0) || 0,
  } = options;

  // 1. Ground truth set: incidents with at least one Correction.
  const incidents = await prisma.incident.findMany({
    where: {
      corrections: { some: {} },
      ...(seedOnly ? { source: "seed" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { corrections: { orderBy: { createdAt: "desc" } } },
  });

  const sampleSize = incidents.length;
  const lowSample = sampleSize < DEFAULT_LIMIT;

  const emptyResult = (): EvalResult => ({
    evalRunId: null,
    written: false,
    sampleSize,
    effectiveSampleSize: 0,
    lowSample,
    sampleBelowTrustThreshold: true,
    fields: {
      severity: macroMetrics([]),
      team: macroMetrics([]),
      duplicate: macroMetrics([]),
    },
    aggregate: aggregate([]),
    judge: { judged: 0, judgeCredited: 0, judgeFailed: 0 },
    classifyFailures: 0,
    drift: { driftFlag: false, rollingAvg: null, relativeDrop: null, historyRuns: 0 },
  });

  if (sampleSize === 0) {
    // Writing a 0/0/0 EvalRun would poison the rolling average and fake a drift
    // alert on the next run, so persist nothing.
    console.warn(
      JSON.stringify({
        event: "eval.no_ground_truth",
        msg: "no incidents with corrections found; nothing to evaluate",
        evalRunWritten: false,
      })
    );
    return emptyResult();
  }
  if (lowSample) {
    console.warn(
      JSON.stringify({
        event: "eval.low_sample",
        sampleSize,
        target: DEFAULT_LIMIT,
        msg: "fewer corrected incidents than target; scores are noisy",
      })
    );
  }

  // Dedupe pool for the duplicate field — the same pool production compares
  // against (open incidents with embeddings).
  const pool = await prisma.incident.findMany({
    where: { status: "OPEN" },
    select: { id: true, embedding: true },
  });

  const severitySamples: Sample[] = [];
  const teamSamples: Sample[] = [];
  const duplicateSamples: Sample[] = [];
  const counters: JudgeCounters = { judged: 0, judgeCredited: 0, judgeFailed: 0 };
  let classifyFailures = 0;

  for (const incident of incidents) {
    // Latest correction per field is the ground truth.
    const truth = new Map<string, string>();
    for (const c of incident.corrections) {
      if (!truth.has(c.field)) truth.set(c.field, c.correctedValue);
    }

    // 2. Re-run the real production pipeline (router, not a shortcut).
    let predictedSeverity: string | null = null;
    let predictedTeam: string | null = null;
    try {
      const { data } = await classify(incident.title, incident.body);
      predictedSeverity = data.severity;
      predictedTeam = data.suggestedTeam;
    } catch (err) {
      classifyFailures++;
      console.warn(
        JSON.stringify({
          event: "eval.classify_failed",
          incidentId: incident.id,
          reason: err instanceof Error ? err.message : String(err),
        })
      );
    }

    // 3. Score each field that has ground truth.
    const sevTruth = truth.get("severity");
    if (sevTruth && predictedSeverity) {
      const match = await isMatch("severity", predictedSeverity, sevTruth, incident, counters);
      // A judge-credited answer is counted as correct for that class.
      severitySamples.push({
        predicted: match ? sevTruth : predictedSeverity,
        actual: sevTruth,
      });
    }

    const teamTruth = truth.get("team");
    if (teamTruth && predictedTeam) {
      const match = await isMatch("team", predictedTeam, teamTruth, incident, counters);
      teamSamples.push({ predicted: match ? teamTruth : predictedTeam, actual: teamTruth });
    }

    const dupTruth = truth.get("duplicate");
    if (dupTruth) {
      // Duplicate prediction comes from the embedding pipeline, not the LLM.
      const embedding = await embed(`${incident.title}\n\n${incident.body}`);
      const match = findDuplicate(
        embedding,
        pool.filter((p) => p.id !== incident.id)
      );
      duplicateSamples.push({ predicted: match?.id ?? NONE, actual: dupTruth || NONE });
    }

    if (paceMs > 0) {
      await new Promise((r) => setTimeout(r, paceMs));
    }
  }

  // 4. Per-field + aggregate metrics.
  const severity = macroMetrics(severitySamples);
  const team = macroMetrics(teamSamples);
  const duplicate = macroMetrics(duplicateSamples, { negativeLabel: NONE });
  const overall = aggregate([severity, team, duplicate]);

  // Incidents that actually produced scores. A provider outage can fail most
  // classify() calls while sampleSize still looks healthy — metrics from such
  // a run are noise and must not be trusted (or enter drift history as
  // trustworthy: the persisted sampleSize below is this effective count, so
  // the history filter naturally excludes degenerate runs).
  const effectiveSampleSize = sampleSize - classifyFailures;
  const sampleBelowTrustThreshold = effectiveSampleSize < minTrustworthySample;
  if (classifyFailures > 0) {
    console.warn(
      JSON.stringify({
        event: "eval.degraded_run",
        sampleSize,
        classifyFailures,
        effectiveSampleSize,
        trustworthy: !sampleBelowTrustThreshold,
      })
    );
  }

  // 5. Drift vs rolling average of the last N runs (empty history -> no drift).
  // Sparse runs are still written for audit history, but their F1 is noise —
  // excluded here so a small sample can't drag the baseline and fake drift on
  // a later healthy run.
  const history = await prisma.evalRun.findMany({
    where: { sampleSize: { gte: minTrustworthySample } },
    orderBy: { createdAt: "desc" },
    take: ROLLING_WINDOW,
    select: { f1: true },
  });
  const { drift, rollingAvg, relativeDrop } = detectDrift(
    overall.f1,
    history.map((h) => h.f1),
    DRIFT_THRESHOLD
  );

  // 6. Persist the run. sampleSize stores the EFFECTIVE (scored) count so the
  // rolling-average filter above excludes degenerate runs automatically.
  const run = await prisma.evalRun.create({
    data: {
      precision: overall.precision,
      recall: overall.recall,
      f1: overall.f1,
      sampleSize: effectiveSampleSize,
      driftFlag: drift,
    },
  });

  return {
    evalRunId: run.id,
    written: true,
    sampleSize,
    effectiveSampleSize,
    lowSample,
    sampleBelowTrustThreshold,
    fields: { severity, team, duplicate },
    aggregate: overall,
    judge: counters,
    classifyFailures,
    drift: { driftFlag: drift, rollingAvg, relativeDrop, historyRuns: history.length },
  };
}
