"use client";

// F1 over time, with the CI drift gate drawn as a threshold line.
//
// Recharts owns the axes, grid, tooltip and dots; the f1 stroke itself is a
// framer-motion path so it can self-draw with Phase 2's selfDrawVariant rather
// than Recharts' built-in animation. Recharts 3 exposes the axis scales as hooks,
// so the path uses the chart's real geometry instead of a parallel guess.
import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useXAxisScale,
  useYAxisScale,
} from "recharts";
import { getSelfDrawVariant } from "@/components/motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { EvalRun } from "@/types/evalRun";
import {
  DRIFT_THRESHOLD,
  driftContext,
  formatF1,
  isTrustworthy,
  runLabel,
} from "../drift";

interface ChartPoint {
  label: string;
  f1: number;
  precision: number;
  recall: number;
  sampleSize: number;
  driftFlag: boolean;
  trusted: boolean;
}

// memo: the parent re-renders on unrelated store updates (session hydrate);
// `runs` is referentially stable from EvalMetrics' useMemo, so this skips a full
// Recharts re-render in that case.
export const DriftChart = memo(function DriftChart({ runs }: { runs: EvalRun[] }) {
  const reduced = useReducedMotion();

  const data = useMemo<ChartPoint[]>(
    () =>
      [...runs]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((run) => ({
          label: runLabel(run),
          f1: run.f1,
          precision: run.precision,
          recall: run.recall,
          sampleSize: run.sampleSize,
          driftFlag: run.driftFlag,
          trusted: isTrustworthy(run),
        })),
    [runs]
  );

  const { threshold, rollingAvg, latest } = useMemo(() => driftContext(runs), [runs]);
  const breached = latest?.driftFlag === true;

  if (data.length === 0) return null;

  return (
    // Below ~420px the chart scrolls horizontally instead of crushing the axes:
    // the outer div scrolls, the inner one enforces a readable floor width.
    <div className="w-full overflow-x-auto">
      <div className="h-72 w-full min-w-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
            <defs>
              {/* Static glow — no animation, so nothing here needs a reduced-motion
                  path. It reads as a status light on the gate line. */}
              <filter id="drift-gate-glow" x="-20%" y="-400%" width="140%" height="900%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
            {/* 12px mirrors the text-mono-sm token (0.75rem) — Recharts takes
                numbers, not classes, so the size is stated here once. */}
            <XAxis
              dataKey="label"
              stroke="var(--color-muted)"
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 1]}
              stroke="var(--color-muted)"
              tick={{ fontSize: 12 }}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-muted)" }}
              // Recharts types the value as ValueType | undefined; narrow rather than
              // cast, so a non-numeric payload renders as-is instead of crashing.
              formatter={(value, name) => [
                typeof value === "number" ? formatF1(value) : String(value ?? "—"),
                String(name ?? "F1"),
              ]}
            />

            {threshold !== null && (
              <ReferenceLine
                y={threshold}
                // Breach is a merge-blocking CI state, so it gets the alert token and
                // a glow; otherwise it stays a quiet reference.
                stroke={breached ? "var(--color-alert)" : "var(--color-muted)"}
                strokeWidth={breached ? 2 : 1}
                strokeDasharray={breached ? undefined : "5 4"}
                filter={breached ? "url(#drift-gate-glow)" : undefined}
                ifOverflow="extendDomain"
                label={{
                  value: breached
                    ? `DRIFT GATE ${formatF1(threshold)} — BREACHED`
                    : `drift gate ${formatF1(threshold)} (avg ${formatF1(rollingAvg ?? 0)} −${DRIFT_THRESHOLD * 100}%)`,
                  position: "insideBottomRight",
                  fill: breached ? "var(--color-alert)" : "var(--color-muted)",
                  fontSize: 12,
                }}
              />
            )}

            {/* stroke="none": the visible stroke is the motion path below. This Line
                still owns the dots and the tooltip's hit testing. */}
            <Line
              type="linear"
              dataKey="f1"
              name="F1"
              stroke="none"
              isAnimationActive={false}
              dot={<F1Dot />}
              activeDot={{ r: 4, fill: "var(--color-lime)" }}
            />

            <SelfDrawF1Line data={data} reduced={reduced} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

/**
 * The drawn f1 stroke.
 *
 * Mount-once semantics: `variants` is memoised on `reduced` alone and the
 * initial/animate states are constant strings, so a data change (filter toggle)
 * re-renders new geometry without ever re-entering the "hidden" state — framer
 * only animates on a state transition, and there is none after mount. This
 * component is also never keyed by data, so it cannot remount and replay.
 */
function SelfDrawF1Line({ data, reduced }: { data: ChartPoint[]; reduced: boolean }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const variants = useMemo(() => getSelfDrawVariant(reduced), [reduced]);

  const d = useMemo(() => {
    if (!xScale || !yScale) return "";
    const points = data
      .map((p) => {
        const x = xScale(p.label);
        const y = yScale(p.f1);
        return typeof x === "number" && typeof y === "number" ? `${x},${y}` : null;
      })
      .filter((p): p is string => p !== null);
    if (points.length === 0) return "";
    // A single run has no segment to draw — emit a degenerate line so the point
    // still gets a mark rather than an invisible path.
    if (points.length === 1) return `M ${points[0]} L ${points[0]}`;
    return `M ${points[0]} ${points.slice(1).map((p) => `L ${p}`).join(" ")}`;
  }, [data, xScale, yScale]);

  if (!d) return null;

  return (
    <motion.path
      d={d}
      fill="none"
      stroke="var(--color-lime)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={variants}
      // initial={false} under reduced motion renders straight at the `visible`
      // state with no transition at all — "render the completed chart directly",
      // rather than a 0.15s opacity fade that still starts from invisible.
      initial={reduced ? false : "hidden"}
      animate="visible"
    />
  );
}

/** Dot per run: alert-filled where that run flagged drift, hollow when untrusted. */
function F1Dot(props: { cx?: number; cy?: number; payload?: ChartPoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const drift = payload.driftFlag;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={drift ? 4 : 3}
      fill={drift ? "var(--color-alert)" : payload.trusted ? "var(--color-lime)" : "var(--color-void)"}
      stroke={drift ? "var(--color-alert)" : "var(--color-lime)"}
      strokeWidth={1.5}
    />
  );
}

export default DriftChart;
