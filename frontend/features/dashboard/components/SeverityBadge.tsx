"use client";

// Severity chip. CRITICAL is the only severity that moves (pulseVariant) — LOW,
// MEDIUM and HIGH are static colour so the pulse stays a signal, not a texture.
import { motion } from "framer-motion";
import { Badge } from "@/components/ui";
import { getPulseVariant } from "@/components/motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils/cn";
import type { Severity } from "@/types/incident";

const SEVERITY_STYLES: Record<Severity, string> = {
  CRITICAL: "border-alert/60 text-alert",
  HIGH: "border-alert/30 text-alert/80",
  MEDIUM: "border-lime/30 text-lime/80",
  LOW: "border-border text-muted",
};

export function SeverityBadge({
  severity,
  pending = false,
}: {
  severity: Severity;
  /**
   * True while classification hasn't completed. The schema stores a placeholder
   * "LOW" on unclassified rows (severity is non-nullable server-side), so showing
   * that value would present a guess as a fact — render PENDING instead.
   */
  pending?: boolean;
}) {
  const reduced = useReducedMotion();

  if (pending) {
    return <Badge className="border-border text-muted">Pending</Badge>;
  }

  const badge = <Badge className={cn(SEVERITY_STYLES[severity])}>{severity}</Badge>;

  if (severity !== "CRITICAL") return badge;

  return (
    <motion.span
      className="inline-flex"
      variants={getPulseVariant(reduced)}
      initial="idle"
      animate="pulse"
    >
      {badge}
    </motion.span>
  );
}

export default SeverityBadge;
