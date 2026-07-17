"use client";

// Model eval / drift metrics surface — composed entry point for the "/admin" route.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useSessionStore } from "@/store/sessionStore";
import type { EvalRun } from "@/types/evalRun";
import { useEvalHistory, type EvalDataSource } from "./hooks/useEvalHistory";
import { driftContext, ROLLING_WINDOW } from "./drift";
import { DriftChart } from "./components/DriftChart";
import { EvalRunTable } from "./components/EvalRunTable";
import { ThresholdBreachBanner } from "./components/ThresholdBreachBanner";

type Window = "all" | "rolling";

export function EvalMetrics({
  /**
   * A single EvalRun the server resolved from ?jobId= via the cron poll route.
   * Only used if the history route 404s — it is the graceful-degradation source,
   * never a supplement to real history.
   */
  fallbackRun = null,
  fallbackNote = null,
}: {
  fallbackRun?: EvalRun | null;
  fallbackNote?: string | null;
}) {
  const { status, runs, source, error, reload } = useEvalHistory(fallbackRun);
  const [window, setWindow] = useState<Window>("all");
  const user = useSessionStore((s) => s.user);
  const hydrate = useSessionStore((s) => s.hydrate);

  // Role display only — the route itself is already gated by middleware.ts.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const visible = useMemo(() => {
    if (window === "all") return runs;
    // Mirrors the backend's rolling window: the newest ROLLING_WINDOW runs.
    return [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-ROLLING_WINDOW);
  }, [runs, window]);

  // Drift context always comes from the FULL set: narrowing the view must not
  // change the gate line, or the chart would show a threshold the CI never used.
  const context = useMemo(() => driftContext(runs), [runs]);

  return (
    <main className="min-h-screen bg-void px-6 py-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-sm font-mono text-mono-sm uppercase text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime"
          >
            ← Undertow
          </Link>
          {user && (
            <span className="ml-auto font-mono text-mono-sm text-muted">
              {user.email ?? user.name ?? user.id} · {user.role}
            </span>
          )}
        </div>

        <header>
          <h1 className="font-display text-heading text-text">Classifier eval</h1>
          <p className="mt-1 text-label text-muted">
            F1 against human corrections, per eval run. The gate line is the rule the
            Eval Gate check enforces on pull requests.
          </p>
        </header>

        {status === "loading" && (
          <p className="py-8 font-mono text-mono-sm text-muted">Loading eval runs…</p>
        )}

        {status === "error" && (
          <div className="flex flex-col items-start gap-3 py-8">
            <p role="alert" className="text-label text-alert">
              {error}
            </p>
            <Button variant="ghost" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        )}

        {status === "ready" && (
          <>
            <ThresholdBreachBanner context={context} />

            <ProvenanceNote source={source} runCount={runs.length} fallbackNote={fallbackNote} />

            {runs.length === 0 ? (
              // Explicitly NOT an empty chart: there is nothing to plot and the note
              // above says why.
              <p className="py-4 font-mono text-mono-sm text-muted">No eval runs to plot.</p>
            ) : (
              <>
                {source === "history" && runs.length > ROLLING_WINDOW && (
                  <div
                    role="radiogroup"
                    aria-label="Run window"
                    className="flex gap-1 self-start rounded-lg border border-border bg-card/40 p-1"
                  >
                    {([
                      { value: "all", label: `All (${runs.length})` },
                      { value: "rolling", label: `Rolling ${ROLLING_WINDOW}` },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={window === opt.value}
                        onClick={() => setWindow(opt.value)}
                        className={cn(
                          "rounded-md px-3 py-1.5 font-mono text-mono-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime",
                          window === opt.value ? "bg-card text-text" : "text-muted hover:text-text"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Not keyed by data — a key change would remount the chart and
                    replay the self-draw on every filter toggle. */}
                <DriftChart runs={visible} />
                <EvalRunTable runs={visible} />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/** Says where the numbers came from. Never silently shows a degraded view. */
function ProvenanceNote({
  source,
  runCount,
  fallbackNote,
}: {
  source: EvalDataSource;
  runCount: number;
  fallbackNote: string | null;
}) {
  if (source === "history") {
    if (runCount === 1) {
      return (
        <Note>
          Only one eval run has been recorded, so there is no trend yet and no gate
          line — the drift rule needs at least one prior run to average against.
        </Note>
      );
    }
    return null;
  }

  if (source === "single-job") {
    return (
      <Note>
        Historical trend data isn&apos;t available yet: the eval-run history endpoint
        (<span className="font-mono">GET /api/eval-runs</span>) hasn&apos;t shipped on
        the backend. Showing the single run resolved from the job id in the URL. No
        gate line is drawn — a rolling average needs prior runs, and none can be read
        without that endpoint.
      </Note>
    );
  }

  return (
    <Note>
      Historical trend data isn&apos;t available yet: the eval-run history endpoint
      (<span className="font-mono">GET /api/eval-runs</span>) hasn&apos;t shipped on
      the backend, so there is nothing to chart.
      {fallbackNote ? ` ${fallbackNote}` : ""} A single run can be shown by appending{" "}
      <span className="font-mono">?jobId=&lt;id&gt;</span> from a completed eval job.
    </Note>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-card/40 p-3 text-label text-muted">
      {children}
    </p>
  );
}

export default EvalMetrics;
