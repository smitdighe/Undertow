"use client";

// The sink zone: a strip directly below the waterline where live-arriving
// duplicates surface partway, dwell, then get pulled back under. The signature
// moment — so bursts matter: chips lay out in a single non-wrapping flex row,
// each owning its slot, which is what keeps five near-simultaneous duplicates
// from ever overlapping or stacking on one spot.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Variants } from "framer-motion";
import { getRiseVariant, getSinkVariant } from "@/components/motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useIncidentStore, type SinkItem } from "@/store/incidentStore";

/** How long a chip holds at the surface before sinking. */
const DWELL_MS = 1400;
/**
 * Backstop retirement, independent of the animation. Framer completes via rAF,
 * and rAF is suspended in hidden tabs — without this, a chip whose sink never
 * renders would sit forever. Timers are throttled when hidden but do fire.
 */
const MAX_LIFETIME_MS = DWELL_MS + 1800;

export function DuplicateSinkIndicator() {
  const sinking = useIncidentStore((s) => s.sinking);
  const suppressedCount = useIncidentStore((s) => s.suppressedCount);

  if (sinking.length === 0 && suppressedCount === 0) return null;

  return (
    // Single row, no wrap: each chip owns a flex slot, so a burst can never
    // stack chips on one spot or collide rows; overflow past the line clips.
    // The counter, not the chips, is the durable record of a big burst.
    <div className="flex min-h-8 flex-nowrap items-start gap-2 overflow-hidden pt-2">
      <AnimatePresence initial={false}>
        {sinking.map((chip) => (
          <SinkChip key={chip.key} chip={chip} />
        ))}
      </AnimatePresence>

      {suppressedCount > 0 && (
        <span className="ml-auto shrink-0 pt-1 font-mono text-mono-sm text-muted">
          {suppressedCount} pulled under
        </span>
      )}
    </div>
  );
}

function SinkChip({ chip }: { chip: SinkItem }) {
  const reduced = useReducedMotion();
  const retireSink = useIncidentStore((s) => s.retireSink);
  // Two-beat choreography driven by variant state: rise to the surface, then
  // after DWELL_MS sink back under. Composed from Phase 2's rise/sink variants —
  // reduced-motion swaps in their opacity-only twins, so the fallback is an
  // instant appear/fade with zero travel, not a slower version of the journey.
  const [phase, setPhase] = useState<"visible" | "sunk">("visible");

  const variants = useMemo<Variants>(() => {
    const rise = getRiseVariant(reduced);
    const sink = getSinkVariant(reduced);
    return { hidden: rise.hidden, visible: rise.visible, sunk: sink.hidden };
  }, [reduced]);

  useEffect(() => {
    const dwell = setTimeout(() => setPhase("sunk"), DWELL_MS);
    // retireSink is idempotent (filter by key), so whichever of animation
    // completion / this backstop lands first wins and the other is a no-op.
    const backstop = setTimeout(
      () => useIncidentStore.getState().retireSink(chip.key),
      MAX_LIFETIME_MS
    );
    return () => {
      clearTimeout(dwell);
      clearTimeout(backstop);
    };
  }, [chip.key]);

  return (
    <motion.span
      variants={variants}
      initial="hidden"
      animate={phase}
      onAnimationComplete={(definition) => {
        // Fires for both beats; only the sink retires the chip. By then it is
        // already at opacity 0, so unmount is invisible.
        if (definition === "sunk") retireSink(chip.key);
      }}
      className="inline-flex max-w-48 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/80 px-2.5 py-1 font-mono text-mono-sm text-muted"
    >
      <span aria-hidden="true">↓</span>
      <span className="truncate">{chip.incident.title}</span>
    </motion.span>
  );
}

export default DuplicateSinkIndicator;
