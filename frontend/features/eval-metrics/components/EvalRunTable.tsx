"use client";

// Tabular view of the same runs the chart plots. Newest first — the opposite of
// the chart's chronological axis, because a table is read top-down for "what
// happened last".
import { memo } from "react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { EvalRun } from "@/types/evalRun";
import { formatF1, isTrustworthy, MIN_TRUSTWORTHY_SAMPLE, runLabel } from "../drift";

// memo: skips the full table re-render when the parent updates for unrelated
// reasons (session hydrate) — `runs` is referentially stable from EvalMetrics.
export const EvalRunTable = memo(function EvalRunTable({ runs }: { runs: EvalRun[] }) {
  if (runs.length === 0) return null;

  const ordered = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Eval runs, newest first</caption>
        <thead>
          <tr className="border-b border-border">
            {["Run", "F1", "Precision", "Recall", "Sample", "Drift"].map((h) => (
              <th
                key={h}
                scope="col"
                className="whitespace-nowrap py-2 pr-4 font-mono text-mono-sm uppercase text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((run) => {
            const trusted = isTrustworthy(run);
            return (
              <tr key={run.id} className="border-b border-border/50">
                <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-mono-sm text-muted">
                  {runLabel(run)}
                </td>
                <td
                  className={cn(
                    "py-2.5 pr-4 font-mono text-mono-sm",
                    run.driftFlag ? "text-alert" : "text-text"
                  )}
                >
                  {formatF1(run.f1)}
                </td>
                <td className="py-2.5 pr-4 font-mono text-mono-sm text-muted">
                  {formatF1(run.precision)}
                </td>
                <td className="py-2.5 pr-4 font-mono text-mono-sm text-muted">
                  {formatF1(run.recall)}
                </td>
                <td className="py-2.5 pr-4 font-mono text-mono-sm">
                  <span className={trusted ? "text-muted" : "text-alert/80"}>
                    {run.sampleSize}
                  </span>
                  {!trusted && (
                    // The backend excludes these from the rolling average; saying so
                    // explains why a low number doesn't move the gate line.
                    <span
                      className="ml-2 text-muted"
                      title={`Below the trust threshold of ${MIN_TRUSTWORTHY_SAMPLE} — excluded from the rolling average`}
                    >
                      untrusted
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4">
                  {run.driftFlag ? (
                    <Badge className="border-alert/60 text-alert">Drift</Badge>
                  ) : (
                    <span className="font-mono text-mono-sm text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

export default EvalRunTable;
