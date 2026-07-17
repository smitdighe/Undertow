"use client";

// Shown when the newest EvalRun carries driftFlag === true.
//
// Copy states the actual numbers and the actual consequence. The rule mirrored
// here is the one enforced in .github/workflows/eval-gate.yml, which runs
// scripts/eval-runner.ts --fail-on-drift --min-sample 10 and exits 1 (blocking
// the merge) on exactly this condition, for PRs touching backend/lib/llm/**.
import { DRIFT_THRESHOLD, formatF1, formatPercent, type DriftContext } from "../drift";

export function ThresholdBreachBanner({ context }: { context: DriftContext }) {
  const { latest, rollingAvg, threshold, relativeDrop, historyRuns } = context;
  if (!latest?.driftFlag) return null;

  return (
    <div
      role="alert"
      className="mb-5 rounded-xl border border-alert/50 bg-alert/5 p-4"
    >
      <p className="mb-2 font-mono text-mono-sm uppercase text-alert">
        Drift detected — merges blocked
      </p>

      <p className="text-label text-text">
        This run scored <span className="font-mono text-alert">{formatF1(latest.f1)}</span> F1
        {rollingAvg !== null && (
          <>
            {" "}against a rolling average of{" "}
            <span className="font-mono">{formatF1(rollingAvg)}</span> over the last{" "}
            {historyRuns} {historyRuns === 1 ? "run" : "runs"}
          </>
        )}
        {relativeDrop !== null && (
          <>
            {" "}— a <span className="font-mono text-alert">{formatPercent(relativeDrop)}</span>{" "}
            relative drop, past the {DRIFT_THRESHOLD * 100}% limit
          </>
        )}
        {threshold !== null && (
          <>
            {" "}(anything under <span className="font-mono">{formatF1(threshold)}</span> trips
            the gate)
          </>
        )}
        .
      </p>

      <p className="mt-2 text-label text-muted">
        The Eval Gate check fails on this condition, so pull requests touching the
        classifier (<span className="font-mono">backend/lib/llm/**</span>) can&apos;t merge
        until F1 recovers or the baseline is re-established. Classifier quality has
        regressed against human corrections — inspect recent prompt or model changes.
      </p>

      {latest.sampleSize < 10 && (
        <p className="mt-2 text-label text-muted">
          Caveat: this run scored only {latest.sampleSize}{" "}
          {latest.sampleSize === 1 ? "incident" : "incidents"}, below the trust
          threshold of 10 — CI treats a sample this small as untrustworthy and fails
          loudly rather than reporting drift as fact.
        </p>
      )}
    </div>
  );
}

export default ThresholdBreachBanner;
