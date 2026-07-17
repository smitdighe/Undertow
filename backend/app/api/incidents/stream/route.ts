import { NextRequest } from "next/server";
import { subscribe, type IncidentEvent } from "@/lib/sse/broadcaster";
import { ensureIncidentListener } from "@/lib/sse/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * SSE stream of live incident events.
 *
 * - Idle with no incidents is the normal state: the stream stays open, a
 *   comment heartbeat every 25s keeps proxies from closing it. It never hangs
 *   or errors waiting.
 * - Subscribes on connect, and unsubscribes on the request abort signal (client
 *   disconnect) so the broadcaster never accumulates dead listeners.
 */
export async function GET(req: NextRequest) {
  // Ensure this process is listening to Postgres NOTIFY (cross-process bridge).
  ensureIncidentListener();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (chunk: string): boolean => {
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // Controller closed underneath us — tear down this connection.
          cleanup();
          return false;
        }
      };

      // Prime the stream: SSE retry hint + a comment so the connection is
      // immediately established even before any incident arrives.
      send(`retry: 3000\n\n: connected\n\n`);

      const listener = (incident: IncidentEvent) => {
        send(`event: incident\ndata: ${JSON.stringify(incident)}\n\n`);
      };
      unsubscribe = subscribe(listener);

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
      }, HEARTBEAT_MS);

      // Client disconnected — free the listener so it doesn't leak.
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
