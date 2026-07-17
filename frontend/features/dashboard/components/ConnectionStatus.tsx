"use client";

// Honest transport indicator. Renders exactly what the stream state machine
// reports — "live" appears only after EventSource onopen, never optimistically.
import { useIncidentStore } from "@/store/incidentStore";
import type { StreamState } from "@/lib/sse/createIncidentStream";
import { cn } from "@/lib/utils/cn";

const STATES: Record<StreamState, { label: string; dot: string }> = {
  connecting: { label: "connecting", dot: "bg-muted" },
  live: { label: "live", dot: "bg-lime" },
  reconnecting: { label: "reconnecting", dot: "bg-alert/70" },
  polling: { label: "polling fallback", dot: "bg-lime/40" },
  offline: { label: "offline", dot: "bg-alert" },
};

export function ConnectionStatus() {
  const streamState = useIncidentStore((s) => s.streamState);
  const { label, dot } = STATES[streamState];

  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 font-mono text-mono-sm uppercase text-muted"
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

export default ConnectionStatus;
