"use client";

// The feed: every non-DUPLICATE incident, newest first. Duplicates never render
// here — live ones sink in the zone above; an incident corrected to DUPLICATE
// leaves this list, which AnimatePresence turns into its sink-out exit.
//
// Render cost is deliberately layered: this component re-renders only when the
// id list changes (useShallow); each card subscribes to its own entry, so an SSE
// update to one incident re-renders one card. Combined with the store's 80ms
// ingest buffer, a burst of N events lands as one list update, not N.
import { forwardRef } from "react";
import { AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui";
import { useIncidentStore } from "@/store/incidentStore";
import type { Incident } from "@/types/incident";
import { IncidentCard } from "./IncidentCard";

export function IncidentFeed({
  onCorrect,
  onRetry,
}: {
  onCorrect?: (incident: Incident) => void;
  onRetry: () => void;
}) {
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    // Dev-only render counter, asserted in QA against event bursts.
    const w = window as unknown as { __undertowFeedRenders?: number };
    w.__undertowFeedRenders = (w.__undertowFeedRenders ?? 0) + 1;
  }

  const ids = useIncidentStore(
    useShallow((s) => s.order.filter((id) => s.entries[id].status !== "DUPLICATE"))
  );
  const hydrated = useIncidentStore((s) => s.hydrated);
  const loadError = useIncidentStore((s) => s.loadError);

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p role="alert" className="text-label text-alert">
          {loadError}
        </p>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (!hydrated) {
    return <p className="py-8 font-mono text-mono-sm text-muted">Loading feed…</p>;
  }

  if (ids.length === 0) {
    return (
      <p className="py-8 font-mono text-mono-sm text-muted">
        No incidents. The line is quiet.
      </p>
    );
  }

  return (
    // aria-live: newly arrived/updated incidents are announced without needing
    // to see the rise/sink motion. Polite, so a burst never interrupts the
    // user mid-read; the region mounts WITH its initial page, so first load
    // isn't read out card by card.
    <div className="flex flex-col gap-3" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        {ids.map((id) => (
          <FeedRow key={id} id={id} onCorrect={onCorrect} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Per-card subscription: an update to one incident re-renders only its row.
 * forwardRef because AnimatePresence mode="popLayout" measures its direct child
 * through a ref — the chain runs FeedRow -> IncidentCard -> motion.article.
 */
const FeedRow = forwardRef<HTMLElement, {
  id: string;
  onCorrect?: (incident: Incident) => void;
}>(function FeedRow({ id, onCorrect }, ref) {
  const incident = useIncidentStore((s) => s.entries[id]);
  const arrived = useIncidentStore((s) => Boolean(s.arrivals[id]));
  // Exit animations: AnimatePresence keeps this row mounted briefly after its id
  // leaves the list, but the entry itself still exists in the store (duplicates
  // are kept as data), so incident is defined for the exit frame.
  if (!incident) return null;
  return <IncidentCard ref={ref} incident={incident} arrived={arrived} onCorrect={onCorrect} />;
});

export default IncidentFeed;
