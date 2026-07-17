// Client-side reconstruction of the backend's drift rule.
//
// The EvalRun row persists only the boolean `driftFlag` — not the rolling average
// or the threshold it was judged against. To draw the gate line we have to
// recompute it, so this MUST mirror backend/lib/eval/runner.ts + metrics.ts
// exactly. Constants are duplicated deliberately (the frontend has no import path
// into backend/); if they change there, change them here.
//
// The rule, from metrics.ts detectDrift():
//   relativeDrop = (rollingAvg - currentF1) / rollingAvg
//   drift        = relativeDrop > 0.05
// which means the gate line sits at rollingAvg * (1 - 0.05) — a RELATIVE 5% cut,
// not rollingAvg minus 0.05 absolute. At avg 0.80 the gate is 0.76, not 0.75.
import type { EvalRun } from "@/types/evalRun";

/** backend/lib/eval/runner.ts DRIFT_THRESHOLD */
export const DRIFT_THRESHOLD = 0.05;
/**
 * metrics.ts guards the comparison with `relativeDrop > threshold + 1e-9`, so an
 * exactly-5% drop is NOT drift (float error would otherwise compute 0.05 as
 * 0.05000000000000004 and trip a "more than 5%" rule). Folding the same epsilon
 * into the gate line keeps "strictly below the line" equivalent to driftFlag at
 * the boundary instead of off by 1e-16.
 */
export const DRIFT_EPSILON = 1e-9;
/** backend/lib/eval/runner.ts ROLLING_WINDOW */
export const ROLLING_WINDOW = 5;
/** backend/lib/eval/runner.ts MIN_TRUSTWORTHY_SAMPLE */
export const MIN_TRUSTWORTHY_SAMPLE = 10;

/**
 * Runs below the trust threshold are still written for audit history, but the
 * backend excludes them from the rolling average so a tiny sample can't drag the
 * baseline. The chart marks them, and this predicate gates the same maths.
 */
export const isTrustworthy = (run: EvalRun) => run.sampleSize >= MIN_TRUSTWORTHY_SAMPLE;

export const byCreatedAtAsc = (a: EvalRun, b: EvalRun) =>
  a.createdAt.localeCompare(b.createdAt);

export interface DriftContext {
  /** Mean f1 of the trustworthy runs preceding `latest`. Null when there are none. */
  rollingAvg: number | null;
  /**
   * The exact gate: a run drifts iff its f1 is strictly below this. Equal to
   * rollingAvg * (1 - DRIFT_THRESHOLD - DRIFT_EPSILON). Null when rollingAvg is.
   */
  threshold: number | null;
  /** (rollingAvg - latest.f1) / rollingAvg. Null when rollingAvg is null or 0. */
  relativeDrop: number | null;
  /** How many runs fed the average (<= ROLLING_WINDOW). */
  historyRuns: number;
  latest: EvalRun | null;
}

const EMPTY: DriftContext = {
  rollingAvg: null,
  threshold: null,
  relativeDrop: null,
  historyRuns: 0,
  latest: null,
};

/**
 * Rebuild the drift context for the newest run in `runs`.
 *
 * Mirrors the backend's ordering precisely: the average covers the last
 * ROLLING_WINDOW trustworthy runs *strictly before* the newest one — runner.ts
 * queries history before inserting the current row, so a run is never compared
 * against itself.
 */
export function driftContext(runs: EvalRun[]): DriftContext {
  if (runs.length === 0) return EMPTY;

  const sorted = [...runs].sort(byCreatedAtAsc);
  const latest = sorted[sorted.length - 1];

  const history = sorted
    .slice(0, -1)
    .filter(isTrustworthy)
    .slice(-ROLLING_WINDOW);

  if (history.length === 0) {
    // First-ever run (or no trustworthy predecessors): never drift, no gate line.
    return { ...EMPTY, latest, historyRuns: 0 };
  }

  const rollingAvg = history.reduce((sum, r) => sum + r.f1, 0) / history.length;
  if (rollingAvg === 0) {
    return { rollingAvg, threshold: null, relativeDrop: null, historyRuns: history.length, latest };
  }

  return {
    rollingAvg,
    // Derived so that `f1 < threshold` is exactly the backend's drift condition,
    // epsilon included — see DRIFT_EPSILON.
    threshold: rollingAvg * (1 - DRIFT_THRESHOLD - DRIFT_EPSILON),
    relativeDrop: (rollingAvg - latest.f1) / rollingAvg,
    historyRuns: history.length,
    latest,
  };
}

/** Short, stable axis/table label for a run. */
export function runLabel(run: EvalRun): string {
  const date = new Date(run.createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export const formatF1 = (n: number) => n.toFixed(3);
export const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;
