"use client";

// Tracks the prefers-reduced-motion media query. Consumers pass the result into
// the pickers in components/motion to select a motion-safe variant.
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Returns true when the user has asked for reduced motion.
 *
 * Starts false on the server and on first client paint so markup matches during
 * hydration; the real value lands in the effect immediately after. Variants must
 * therefore treat the reduced path as a swap, never as a mount-time-only branch.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export default useReducedMotion;
