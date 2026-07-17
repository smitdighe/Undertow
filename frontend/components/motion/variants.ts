// Shared Framer Motion variant objects. Plain data, never components — consumers
// spread them onto <motion.*> elements.
//
// Every variant ships a `*Reduced` twin that reaches the same visual end state with
// no movement (opacity-only, or fully instant). Never reference the standard variant
// directly in a component: call the matching `get*Variant(reduced)` picker with the
// value from hooks/useReducedMotion, so the choice can never be forgotten.
import type { Variants } from "framer-motion";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Entrance: fade up into place. */
export const riseVariant: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: EASE_OUT },
  },
};

export const riseVariantReduced: Variants = {
  hidden: { opacity: 0, y: 0 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "linear" } },
};

/** Exit: settle downward while fading out. */
export const sinkVariant: Variants = {
  visible: { opacity: 1, y: 0 },
  hidden: {
    opacity: 0,
    y: 12,
    transition: { duration: 0.45, ease: EASE_OUT },
  },
};

export const sinkVariantReduced: Variants = {
  visible: { opacity: 1, y: 0 },
  hidden: { opacity: 0, y: 0, transition: { duration: 0.15, ease: "linear" } },
};

/** Slow attention loop. Wired to CRITICAL severity in Phase 6. */
export const pulseVariant: Variants = {
  idle: { scale: 1, opacity: 1 },
  pulse: {
    scale: [1, 1.04, 1],
    opacity: [1, 0.78, 1],
    transition: { duration: 2.4, ease: "easeInOut", repeat: Infinity },
  },
};

// A looping pulse is exactly the vestibular trigger reduced-motion exists to stop,
// so the reduced twin holds a static resting state rather than a gentler loop.
export const pulseVariantReduced: Variants = {
  idle: { scale: 1, opacity: 1 },
  pulse: { scale: 1, opacity: 1 },
};

/**
 * Chart path self-draw. The consumer must set `pathLength`-compatible props on the
 * SVG path; Framer normalises stroke-dasharray/dashoffset behind pathLength, so the
 * variant animates 0 -> 1 rather than raw pixel offsets.
 */
export const selfDrawVariant: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: 1.2, ease: EASE_OUT },
      opacity: { duration: 0.2 },
    },
  },
};

// Reduced: the line is simply present. No draw-on.
export const selfDrawVariantReduced: Variants = {
  hidden: { pathLength: 1, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: { opacity: { duration: 0.15 } },
  },
};

export const getRiseVariant = (reduced: boolean): Variants =>
  reduced ? riseVariantReduced : riseVariant;

export const getSinkVariant = (reduced: boolean): Variants =>
  reduced ? sinkVariantReduced : sinkVariant;

export const getPulseVariant = (reduced: boolean): Variants =>
  reduced ? pulseVariantReduced : pulseVariant;

export const getSelfDrawVariant = (reduced: boolean): Variants =>
  reduced ? selfDrawVariantReduced : selfDrawVariant;
