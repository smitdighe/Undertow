"use client";

// One feed row. Entrance (rise) only for incidents that arrived over the live
// stream; initial-load rows mount in place — a page of 30 cards all "arriving"
// at once would be noise, not signal.
import { forwardRef, memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import { Button, Card } from "@/components/ui";
import { getRiseVariant, getSinkVariant } from "@/components/motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils/cn";
import type { Incident, Status } from "@/types/incident";
import { SeverityBadge } from "./SeverityBadge";

const STATUS_STYLES: Record<Status, string> = {
  OPEN: "text-text",
  ESCALATED: "text-alert",
  RESOLVED: "text-muted",
  // Never rendered in the feed (filtered out), but the map stays total.
  DUPLICATE: "text-muted",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString([], { hour12: false });
}

// forwardRef: AnimatePresence mode="popLayout" measures each child through a
// ref; without forwarding it lands on a function component and React warns.
export const IncidentCard = memo(
  forwardRef<HTMLElement, {
    incident: Incident;
    /** Came in over the live stream this session — gets the rise entrance. */
    arrived: boolean;
    /** Present only for ONCALL users; the server still 403s anyone else. */
    onCorrect?: (incident: Incident) => void;
  }>(function IncidentCard({ incident, arrived, onCorrect }, ref) {
  const reduced = useReducedMotion();
  const [draftOpen, setDraftOpen] = useState(false);

  // Rise in, sink out — composed from the Phase 2 variants. Memoised because a
  // fresh variants object each render restarts Framer animations mid-flight
  // (the Phase 3 spike-accumulation bug, same root cause).
  const variants = useMemo<Variants>(() => {
    const rise = getRiseVariant(reduced);
    const sink = getSinkVariant(reduced);
    return { hidden: rise.hidden, visible: rise.visible, exit: sink.hidden };
  }, [reduced]);

  // suggestedTeam is the only honest classification signal: severity can't be
  // it (non-nullable, placeholder LOW), and draftResponse is absent on most
  // seeded rows. Classified rows always have a team (classifier requires min(1)).
  const pendingClassification = incident.suggestedTeam === null;

  return (
    <motion.article
      ref={ref}
      layout={reduced ? false : "position"}
      variants={variants}
      initial={arrived ? "hidden" : false}
      animate="visible"
      exit="exit"
    >
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={incident.severity} pending={pendingClassification} />
          <span
            className={cn(
              "font-mono text-mono-sm uppercase",
              STATUS_STYLES[incident.status]
            )}
          >
            {incident.status}
          </span>
          <span className="ml-auto font-mono text-mono-sm text-muted">
            {incident.source} · {formatTime(incident.createdAt)}
          </span>
        </div>

        <h3 className="font-display text-body font-semibold text-text">
          {incident.title}
        </h3>

        {incident.body && (
          <p className="line-clamp-2 text-label text-muted">{incident.body}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {pendingClassification ? (
            <span className="font-mono text-mono-sm text-muted">Classifying…</span>
          ) : (
            <span className="font-mono text-mono-sm text-text">
              → {incident.suggestedTeam}
            </span>
          )}

          <span className="ml-auto flex items-center gap-2">
            {incident.draftResponse && (
              <Button variant="ghost" size="sm" onClick={() => setDraftOpen((v) => !v)}>
                {draftOpen ? "Hide draft" : "View draft"}
              </Button>
            )}
            {onCorrect && (
              <Button variant="ghost" size="sm" onClick={() => onCorrect(incident)}>
                Correct
              </Button>
            )}
          </span>
        </div>

        {draftOpen && incident.draftResponse && (
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-void/60 p-3 text-label text-muted">
            {incident.draftResponse}
          </p>
        )}
      </Card>
    </motion.article>
  );
  })
);

export default IncidentCard;
