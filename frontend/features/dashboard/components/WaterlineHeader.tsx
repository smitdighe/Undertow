"use client";

// The functional Waterline: counts + connection state above a self-drawing
// baseline, with the duplicate sink zone directly beneath it. Reuses Phase 2's
// selfDrawVariant — no new motion primitives defined here.
import { useMemo } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { getSelfDrawVariant } from "@/components/motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useIncidentStore } from "@/store/incidentStore";
import { ConnectionStatus } from "./ConnectionStatus";
import { ProviderTicker } from "./ProviderTicker";
import { DuplicateSinkIndicator } from "./DuplicateSinkIndicator";

export function WaterlineHeader() {
  const reduced = useReducedMotion();
  const { open, critical } = useIncidentStore(
    useShallow((s) => {
      let open = 0;
      let critical = 0;
      for (const id of s.order) {
        const incident = s.entries[id];
        if (incident.status === "OPEN" || incident.status === "ESCALATED") {
          open += 1;
          // Placeholder severities (unclassified rows) don't count as CRITICAL.
          if (incident.severity === "CRITICAL" && incident.suggestedTeam !== null) {
            critical += 1;
          }
        }
      }
      return { open, critical };
    })
  );

  const drawVariant = useMemo(() => getSelfDrawVariant(reduced), [reduced]);

  return (
    <header className="mb-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className="font-mono text-mono-sm uppercase text-muted">Live feed</h2>
        <span className="font-mono text-mono-sm text-text">{open} open</span>
        {critical > 0 && (
          <span className="font-mono text-mono-sm text-alert">{critical} critical</span>
        )}
        <span className="ml-auto flex items-center gap-4">
          <ProviderTicker />
          <ConnectionStatus />
        </span>
      </div>

      {/* The waterline itself. preserveAspectRatio none + non-scaling stroke so it
          spans any width without distorting; pathLength drives the self-draw. */}
      <svg
        viewBox="0 0 1000 4"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        className="h-[3px] w-full"
      >
        <motion.path
          d="M 0 2 H 1000"
          fill="none"
          stroke="var(--color-lime)"
          strokeOpacity={0.55}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          variants={drawVariant}
          initial="hidden"
          animate="visible"
        />
      </svg>

      <DuplicateSinkIndicator />
    </header>
  );
}

export default WaterlineHeader;
