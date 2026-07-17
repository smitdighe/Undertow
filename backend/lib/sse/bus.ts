import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { broadcast, type IncidentEvent } from "@/lib/sse/broadcaster";

const CHANNEL = "incident_events";

/**
 * Publish an incident change to all processes. Emits a Postgres NOTIFY carrying
 * only the incident id (NOTIFY payloads are capped at ~8000 bytes; a full
 * incident with its 384-float embedding would blow past that). The web
 * process's listener re-fetches the row and fans it out to SSE clients.
 *
 * Works from any process (webhook route, worker) since it rides the existing
 * Prisma connection — no extra client needed on the publish side.
 */
export async function publishIncident(incidentId: string): Promise<void> {
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${incidentId})`;
  } catch (err) {
    // Live updates are best-effort; a NOTIFY failure must never break the
    // webhook response or a worker job. The row is already persisted.
    console.warn(
      JSON.stringify({ event: "sse.publish_failed", incidentId, error: String(err) })
    );
  }
}

async function fetchEvent(incidentId: string): Promise<IncidentEvent | null> {
  const inc = await prisma.incident.findUnique({
    where: { id: incidentId },
    // Deliberately excludes `embedding` — huge and useless to the dashboard.
    select: {
      id: true,
      source: true,
      externalId: true,
      title: true,
      body: true,
      severity: true,
      status: true,
      suggestedTeam: true,
      draftResponse: true,
      duplicateOfId: true,
      createdAt: true,
    },
  });
  if (!inc) return null;
  return { ...inc, createdAt: inc.createdAt.toISOString() };
}

// Singleton LISTEN connection, kept on globalThis so hot-reload / repeated
// route invocations don't open a new pg client each time.
const globalForBus = globalThis as unknown as {
  __undertowBusStarted?: boolean;
};

/**
 * Start the single LISTEN connection for this (web) process. Idempotent —
 * safe to call on every SSE request. Self-reconnects on connection loss.
 */
export function ensureIncidentListener(): void {
  if (globalForBus.__undertowBusStarted) return;
  globalForBus.__undertowBusStarted = true;
  void connect();
}

async function connect(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  const scheduleReconnect = () => {
    globalForBus.__undertowBusStarted = false;
    setTimeout(() => ensureIncidentListener(), 2000);
  };

  client.on("error", (err) => {
    console.warn(JSON.stringify({ event: "sse.listener_error", error: String(err) }));
    client.end().catch(() => {});
    scheduleReconnect();
  });

  client.on("notification", (msg) => {
    const incidentId = msg.payload;
    if (!incidentId) return;
    // Fetch + fan out. Async, but notifications are independent so no ordering
    // guarantee is needed for a live dashboard feed.
    fetchEvent(incidentId)
      .then((event) => {
        if (event) broadcast(event);
      })
      .catch((err) =>
        console.warn(JSON.stringify({ event: "sse.fetch_failed", incidentId, error: String(err) }))
      );
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    console.info(JSON.stringify({ event: "sse.listener_started", channel: CHANNEL }));
  } catch (err) {
    console.warn(JSON.stringify({ event: "sse.listener_connect_failed", error: String(err) }));
    scheduleReconnect();
  }
}
