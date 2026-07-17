"use client";

// Ambient macro "Waterline" for the landing hero. Purely decorative: it invents its
// own timings and never reads real incident data. The functional dashboard Waterline
// (Phase 6) is a separate component and deliberately shares no state with this one.
import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";

// --- Tuning ------------------------------------------------------------------
/** Share of spikes that break the surface instead of sinking back. ~1 in 5. */
const SURFACE_RATIO = 0.2;
/** Gap between arrivals, sampled per spike. The spread is what sells "alerts
 *  arriving" rather than a metronome — see scheduleNext for the skew. */
const SPAWN_MIN_MS = 260;
const SPAWN_MAX_MS = 1600;
/** Travel, in viewBox units above the baseline. */
const SINK_PEAK_MIN = 26;
const SINK_PEAK_MAX = 58;
const SURFACE_PEAK_MIN = 104;
const SURFACE_PEAK_MAX = 148;
/** Seconds. Surfacing reads as a slower, more deliberate climb. */
const SINK_DURATION = 2.1;
const SURFACE_DURATION = 2.9;
/** Hard ceiling on concurrent nodes, so a backgrounded tab can't pile up spikes. */
const MAX_SPIKES = 18;

// --- Geometry ----------------------------------------------------------------
const VIEW_W = 1000;
const VIEW_H = 220;
const BASELINE_Y = 176;
const TICK_H = 13;

interface Spike {
  id: number;
  x: number;
  peak: number;
  duration: number;
  surfaced: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * One spike. Memoised deliberately: the parent re-renders on every spawn, and an
 * unmemoised child hands Framer freshly-allocated keyframe arrays each time, which
 * restarts the animation mid-flight and makes spikes visibly jump.
 */
const SpikeLine = memo(function SpikeLine({ spike }: { spike: Spike }) {
  return (
    <motion.line
      x1={spike.x}
      x2={spike.x}
      y1={BASELINE_Y}
      y2={BASELINE_Y - TICK_H}
      stroke={spike.surfaced ? "var(--color-lime)" : "var(--color-muted)"}
      strokeWidth={spike.surfaced ? 2 : 1.5}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
      initial={{ y: 0, opacity: 0 }}
      animate={
        spike.surfaced
          ? // Breaks the surface: climbs high, fades out up there.
            { y: [0, -spike.peak], opacity: [0, 1, 1, 0] }
          : // Sinks back: rises, falls to baseline, gone before the top.
            { y: [0, -spike.peak, 0], opacity: [0, 0.9, 0] }
      }
      // y and opacity have different keyframe counts, so each needs its own
      // `times`; a shared one would be mismatched against the longer array.
      transition={
        spike.surfaced
          ? {
              y: { duration: spike.duration, ease: "easeOut", times: [0, 1] },
              opacity: {
                duration: spike.duration,
                ease: "linear",
                times: [0, 0.15, 0.7, 1],
              },
            }
          : {
              y: { duration: spike.duration, ease: "easeOut", times: [0, 0.5, 1] },
              opacity: { duration: spike.duration, ease: "linear", times: [0, 0.4, 1] },
            }
      }
    />
  );
});

export function PulseLine() {
  const reduced = useReducedMotion();
  const [spikes, setSpikes] = useState<Spike[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    // Reduced motion gets no scheduler at all — not a slower one.
    if (reduced) return;

    let spawnTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const removalTimers = new Set<ReturnType<typeof setTimeout>>();

    const spawn = () => {
      if (cancelled) return;

      const surfaced = Math.random() < SURFACE_RATIO;
      const spike: Spike = {
        id: nextId.current++,
        x: rand(40, VIEW_W - 40),
        peak: surfaced
          ? rand(SURFACE_PEAK_MIN, SURFACE_PEAK_MAX)
          : rand(SINK_PEAK_MIN, SINK_PEAK_MAX),
        duration: surfaced ? SURFACE_DURATION : SINK_DURATION,
        surfaced,
      };

      setSpikes((prev) => [...prev, spike].slice(-MAX_SPIKES));

      // Retire each spike on its own timer rather than Framer's onAnimationComplete,
      // which never fired here — leaving the cap as the only cull, so the line sat
      // permanently saturated at MAX_SPIKES instead of breathing.
      const removal = setTimeout(() => {
        setSpikes((prev) => prev.filter((s) => s.id !== spike.id));
        removalTimers.delete(removal);
      }, spike.duration * 1000 + 80);
      removalTimers.add(removal);

      scheduleNext();
    };

    const scheduleNext = () => {
      // Squaring the sample biases toward short gaps with occasional long lulls —
      // a uniform delay still reads as a rhythm once the eye adjusts to it.
      const t = Math.random() ** 2;
      spawnTimer = setTimeout(spawn, SPAWN_MIN_MS + t * (SPAWN_MAX_MS - SPAWN_MIN_MS));
    };

    scheduleNext();
    return () => {
      cancelled = true;
      clearTimeout(spawnTimer);
      removalTimers.forEach(clearTimeout);
      removalTimers.clear();
    };
  }, [reduced]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      // Stretch edge-to-edge; non-scaling strokes keep the lines from smearing
      // when the aspect ratio is forced.
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
    >
      <line
        x1="0"
        y1={BASELINE_Y}
        x2={VIEW_W}
        y2={BASELINE_Y}
        stroke="var(--color-border)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />

      {!reduced &&
        spikes.map((spike) => <SpikeLine key={spike.id} spike={spike} />)}
    </svg>
  );
}

export default PulseLine;
