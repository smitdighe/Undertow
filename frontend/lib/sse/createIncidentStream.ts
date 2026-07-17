// Transport layer for the live incident feed. Framework-free on purpose — this is
// a state machine around EventSource + fetch, delivered through callbacks, so it
// can be exercised without rendering anything.
//
// States, and the honest meaning of each:
//   connecting    first EventSource attempt, nothing received yet
//   live          SSE open — events arrive pushed
//   reconnecting  SSE dropped, retrying with backoff (still no data flowing)
//   polling       SSE gave up after MAX_SSE_FAILURES; REST snapshots on an interval
//   offline       even polling can't reach the API; retrying quietly
//
// The server (backend/app/api/incidents/stream) emits `event: incident` with the
// same JSON shape as GET /api/incidents rows, plus comment heartbeats every 25s.
import { incidentSchema, type Incident } from "@/types/incident";
import { listIncidents } from "@/lib/api/incidents";

export type StreamState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling"
  | "offline";

export interface IncidentStreamCallbacks {
  /** One incident, pushed over SSE. */
  onIncident: (incident: Incident) => void;
  /** A full page from the polling fallback. */
  onSnapshot: (incidents: Incident[]) => void;
  onStateChange: (state: StreamState) => void;
}

export interface IncidentStream {
  start: () => void;
  stop: () => void;
  getState: () => StreamState;
}

const STREAM_PATH = "/api/incidents/stream";
/** Consecutive SSE failures before giving up on push and falling back to polling. */
const MAX_SSE_FAILURES = 4;
/** While polling, quietly re-probe SSE this often so we can climb back to live. */
const SSE_REPROBE_MS = 60_000;
const BACKOFF_CAP_MS = 30_000;
/** Consecutive poll failures before admitting we're offline. */
const MAX_POLL_FAILURES = 2;
/** Backend clamps limit to 100; one page is the whole snapshot for this dashboard. */
const SNAPSHOT_LIMIT = 100;

function envInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// NEXT_PUBLIC_* is inlined at build time, so these must be read as static
// property accesses, not dynamic process.env[key] lookups.
const RECONNECT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SSE_RECONNECT !== "false";
const RECONNECT_BASE_MS = envInt(process.env.NEXT_PUBLIC_SSE_RECONNECT_MS, 3000);
const POLL_MS = envInt(process.env.NEXT_PUBLIC_POLL_FALLBACK_MS, 15_000);

export function createIncidentStream(callbacks: IncidentStreamCallbacks): IncidentStream {
  let state: StreamState = "connecting";
  let es: EventSource | null = null;
  let sseFailures = 0;
  let pollFailures = 0;
  let stopped = false;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reprobeTimer: ReturnType<typeof setInterval> | null = null;
  let pollingActive = false;

  const setState = (next: StreamState) => {
    if (stopped || next === state) return;
    state = next;
    callbacks.onStateChange(next);
  };

  const closeEventSource = () => {
    if (es) {
      es.close();
      es = null;
      if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
        // Dev-only leak counter, asserted in QA: must read 1 while the dashboard
        // is mounted and 0 after leaving it.
        const w = window as unknown as { __undertowOpenStreams?: number };
        w.__undertowOpenStreams = Math.max(0, (w.__undertowOpenStreams ?? 1) - 1);
      }
    }
  };

  const handleIncidentEvent = (event: MessageEvent<string>) => {
    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      console.warn("[incident-stream] non-JSON event dropped");
      return;
    }
    // Validate at the boundary; one malformed event must not take the feed down.
    const parsed = incidentSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("[incident-stream] event failed schema validation", parsed.error.issues);
      return;
    }
    callbacks.onIncident(parsed.data);
  };

  const connectSSE = (probing: boolean) => {
    if (stopped || es) return;
    if (!probing) setState(sseFailures === 0 ? "connecting" : "reconnecting");

    es = new EventSource(STREAM_PATH);
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      const w = window as unknown as { __undertowOpenStreams?: number };
      w.__undertowOpenStreams = (w.__undertowOpenStreams ?? 0) + 1;
    }

    es.onopen = () => {
      if (stopped) return;
      sseFailures = 0;
      stopPolling();
      setState("live");
    };

    es.addEventListener("incident", handleIncidentEvent);

    es.onerror = () => {
      if (stopped) return;
      // Own the retry loop entirely: close and schedule ourselves rather than
      // trusting EventSource's built-in retry, so backoff/fallback stay coherent.
      closeEventSource();

      if (pollingActive) return; // probe failed — stay on polling, no state churn

      sseFailures += 1;
      if (!RECONNECT_ENABLED || sseFailures >= MAX_SSE_FAILURES) {
        startPolling();
        return;
      }
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** (sseFailures - 1),
        BACKOFF_CAP_MS
      );
      setState("reconnecting");
      reconnectTimer = setTimeout(() => connectSSE(false), delay);
    };
  };

  const pollOnce = async () => {
    try {
      const page = await listIncidents({ limit: SNAPSHOT_LIMIT });
      pollFailures = 0;
      if (pollingActive) setState("polling");
      callbacks.onSnapshot(page.data);
    } catch {
      pollFailures += 1;
      if (pollFailures >= MAX_POLL_FAILURES) setState("offline");
      // The interval keeps running — a later success flips us back to polling.
    }
  };

  const startPolling = () => {
    if (stopped || pollingActive) return;
    pollingActive = true;
    setState("polling");
    void pollOnce();
    pollTimer = setInterval(() => void pollOnce(), POLL_MS);
    // Periodically try SSE again; onopen tears polling down and returns to live.
    reprobeTimer = setInterval(() => {
      if (!es) connectSSE(true);
    }, SSE_REPROBE_MS);
  };

  const stopPolling = () => {
    pollingActive = false;
    pollFailures = 0;
    if (pollTimer) clearInterval(pollTimer);
    if (reprobeTimer) clearInterval(reprobeTimer);
    pollTimer = null;
    reprobeTimer = null;
  };

  const onBrowserOnline = () => {
    if (stopped) return;
    // Connectivity is back: shortcut every backoff and try SSE immediately.
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pollingActive) void pollOnce();
    if (!es) {
      sseFailures = 0;
      connectSSE(pollingActive);
    }
  };

  return {
    start() {
      if (stopped) return;
      window.addEventListener("online", onBrowserOnline);
      connectSSE(false);
    },
    stop() {
      // Idempotent teardown: unmount and route-change both land here, and leaving
      // an EventSource open across navigations would leak a connection per visit.
      stopped = true;
      window.removeEventListener("online", onBrowserOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      closeEventSource();
    },
    getState: () => state,
  };
}
