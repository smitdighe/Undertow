"use client";

// Owns the stream lifecycle for the dashboard: initial GET on mount, SSE
// subscription, teardown on unmount/route change. The transport itself lives in
// lib/sse/createIncidentStream — this hook only wires it to the store.
import { useCallback, useEffect, useRef } from "react";
import { createIncidentStream } from "@/lib/sse/createIncidentStream";
import { listIncidents } from "@/lib/api/incidents";
import { ApiError, ApiNetworkError } from "@/lib/api/client";
import { useIncidentStore, ingestLiveIncident } from "@/store/incidentStore";

const INITIAL_LIMIT = 100;

export function useIncidentStream() {
  // Guards state writes from a fetch that resolves after unmount.
  const aliveRef = useRef(true);

  const fetchInitial = useCallback(async () => {
    const { loadInitial, setLoadError } = useIncidentStore.getState();
    setLoadError(null);
    try {
      const page = await listIncidents({ limit: INITIAL_LIMIT });
      if (aliveRef.current) loadInitial(page.data);
    } catch (error) {
      if (!aliveRef.current) return;
      // GET /api/incidents is unauthenticated server-side, so there is no 401/403
      // path here — but a proxy 5xx still gets its status named, not swallowed.
      setLoadError(
        error instanceof ApiNetworkError
          ? "Can't reach the server. Check your connection and retry."
          : error instanceof ApiError
            ? `Couldn't load incidents (HTTP ${error.status}). Retry.`
            : "Couldn't load incidents. Retry."
      );
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void fetchInitial();

    const stream = createIncidentStream({
      onIncident: ingestLiveIncident,
      onSnapshot: (incidents) => useIncidentStore.getState().ingestSnapshot(incidents),
      onStateChange: (state) => useIncidentStore.getState().setStreamState(state),
    });
    stream.start();

    // stop() closes the EventSource — leaving it open would leak one connection
    // per dashboard visit. Verified via the dev-only __undertowOpenStreams counter.
    return () => {
      aliveRef.current = false;
      stream.stop();
    };
  }, [fetchInitial]);

  return { retryInitial: fetchInitial };
}
