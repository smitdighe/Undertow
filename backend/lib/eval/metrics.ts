export interface Sample {
  predicted: string;
  actual: string;
}

export interface FieldMetrics {
  precision: number;
  recall: number;
  f1: number;
  /** Number of samples scored for this field. */
  support: number;
  /** Fraction of samples where predicted === actual (after judge credit). */
  accuracy: number;
}

export const EMPTY_METRICS: FieldMetrics = {
  precision: 0,
  recall: 0,
  f1: 0,
  support: 0,
  accuracy: 0,
};

export function f1Score(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Macro-averaged precision/recall/F1 over a multi-class field.
 *
 * Averaging is over classes that actually occur in the ground truth (support >
 * 0) — the standard macro convention. `negativeLabel` (e.g. "none" for the
 * duplicate field) is excluded from the class set, which turns the computation
 * into the usual positive-class precision/recall for that field.
 */
export function macroMetrics(
  samples: Sample[],
  opts: { negativeLabel?: string } = {}
): FieldMetrics {
  if (samples.length === 0) return { ...EMPTY_METRICS };

  const { negativeLabel } = opts;
  const classes = new Set<string>();
  for (const s of samples) {
    if (s.actual !== negativeLabel) classes.add(s.actual);
  }

  const correct = samples.filter((s) => s.predicted === s.actual).length;
  const accuracy = correct / samples.length;

  if (classes.size === 0) {
    // Ground truth is entirely the negative label — no positive class to score.
    return { ...EMPTY_METRICS, support: samples.length, accuracy };
  }

  let pSum = 0;
  let rSum = 0;
  let counted = 0;

  for (const c of Array.from(classes)) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const s of samples) {
      if (s.predicted === c && s.actual === c) tp++;
      else if (s.predicted === c && s.actual !== c) fp++;
      else if (s.predicted !== c && s.actual === c) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    pSum += precision;
    rSum += recall;
    counted++;
  }

  const precision = pSum / counted;
  const recall = rSum / counted;
  return {
    precision,
    recall,
    f1: f1Score(precision, recall),
    support: samples.length,
    accuracy,
  };
}

/**
 * Aggregate per-field metrics into a single score, weighted by each field's
 * support so a field with 2 samples doesn't swing the run as much as one with
 * 50. Fields with no samples are ignored.
 */
export function aggregate(fields: FieldMetrics[]): FieldMetrics {
  const scored = fields.filter((f) => f.support > 0);
  const totalSupport = scored.reduce((n, f) => n + f.support, 0);
  if (totalSupport === 0) return { ...EMPTY_METRICS };

  const precision =
    scored.reduce((n, f) => n + f.precision * f.support, 0) / totalSupport;
  const recall = scored.reduce((n, f) => n + f.recall * f.support, 0) / totalSupport;
  const accuracy =
    scored.reduce((n, f) => n + f.accuracy * f.support, 0) / totalSupport;

  return {
    precision,
    recall,
    f1: f1Score(precision, recall),
    support: totalSupport,
    accuracy,
  };
}

export const SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** True when two severities are adjacent levels (e.g. HIGH vs CRITICAL). */
export function isAdjacentSeverity(a: string, b: string): boolean {
  const i = SEVERITY_ORDER.indexOf(a as (typeof SEVERITY_ORDER)[number]);
  const j = SEVERITY_ORDER.indexOf(b as (typeof SEVERITY_ORDER)[number]);
  if (i < 0 || j < 0) return false;
  return Math.abs(i - j) === 1;
}

/**
 * Rolling-average drift check. Returns true when `current` F1 fell more than
 * `threshold` (relative) below the average of `history`. An empty history (the
 * first-ever run) is never drift.
 */
export function detectDrift(
  currentF1: number,
  history: number[],
  threshold = 0.05
): { drift: boolean; rollingAvg: number | null; relativeDrop: number | null } {
  if (history.length === 0) {
    return { drift: false, rollingAvg: null, relativeDrop: null };
  }
  const rollingAvg = history.reduce((a, b) => a + b, 0) / history.length;
  if (rollingAvg === 0) {
    return { drift: false, rollingAvg, relativeDrop: null };
  }
  const relativeDrop = (rollingAvg - currentF1) / rollingAvg;
  // Epsilon guard: float error makes an exactly-at-threshold drop compute as
  // e.g. 0.05000000000000004, which would trip a "more than 5%" rule.
  return { drift: relativeDrop > threshold + 1e-9, rollingAvg, relativeDrop };
}
