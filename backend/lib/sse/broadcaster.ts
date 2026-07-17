/**
 * In-memory pub/sub for live incident events, scoped to ONE process.
 *
 * This only fans out to listeners in the same process. Cross-process delivery
 * (the worker classifies in a separate process from the web server) is handled
 * by lib/sse/bus.ts, which bridges Postgres LISTEN/NOTIFY into this broadcaster.
 */

export interface IncidentEvent {
  id: string;
  source: string;
  externalId: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  suggestedTeam: string | null;
  draftResponse: string | null;
  duplicateOfId: string | null;
  createdAt: string;
}

type Listener = (incident: IncidentEvent) => void;

// Survive Next.js dev hot-reload: keep the listener set on globalThis so a
// module reload doesn't orphan already-registered SSE connections.
const globalForBroadcaster = globalThis as unknown as {
  __undertowListeners?: Set<Listener>;
};

const listeners: Set<Listener> =
  globalForBroadcaster.__undertowListeners ?? new Set<Listener>();
globalForBroadcaster.__undertowListeners = listeners;

/** Register a listener. Returns an idempotent unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Push an incident to every active listener. One misbehaving listener (e.g. a
 * closed SSE controller throwing on enqueue) must not block delivery to the
 * others, so each call is isolated.
 */
export function broadcast(incident: IncidentEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(incident);
    } catch {
      // A throwing listener is the SSE route's problem to clean up (it
      // unsubscribes itself on failure); never let it break the fan-out.
    }
  });
}

export function listenerCount(): number {
  return listeners.size;
}
