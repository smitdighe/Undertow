import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyGitHubSignature } from "@/lib/webhook/verify";
import { normalizeGitHubIssue } from "@/lib/webhook/normalize";
import { embed } from "@/lib/embeddings";
import { findDuplicate } from "@/lib/dedupe";
import { enqueue } from "@/lib/jobs/queue";
import { publishIncident } from "@/lib/sse/bus";

// transformers.js + node:crypto need the Node runtime, not Edge.
export const runtime = "nodejs";

/**
 * GitHub webhook ingestion. Fast path by design: verify -> normalize ->
 * dedupe -> insert (+ enqueue) -> 200. The LLM router is never called here;
 * classification happens async in the worker.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  // Signature is computed over the raw bytes — read text BEFORE JSON.parse.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeGitHubIssue(payload as Parameters<typeof normalizeGitHubIssue>[0]);
  if (!normalized) {
    // Ping events, non-issue events — acknowledge and ignore.
    return NextResponse.json({ ignored: true }, { status: 200 });
  }

  // GitHub redelivers webhooks (retries, manual redelivery, issue edits reuse
  // the same node_id). externalId is unique — treat repeats as no-ops.
  const existing = await prisma.incident.findUnique({
    where: { externalId: normalized.externalId },
    select: { id: true, status: true },
  });
  if (existing) {
    return NextResponse.json(
      { duplicateDelivery: true, incidentId: existing.id },
      { status: 200 }
    );
  }

  // Semantic dedupe against open incidents (Phase 3 modules).
  const embedding = await embed(`${normalized.title}\n\n${normalized.body}`);
  const openIncidents = await prisma.incident.findMany({
    where: { status: "OPEN" },
    select: { id: true, embedding: true },
  });
  const match = findDuplicate(embedding, openIncidents);

  try {
    if (match) {
      // Known duplicate: record it as DUPLICATE immediately, no CLASSIFY job.
      const incident = await prisma.incident.create({
        data: {
          ...normalized,
          // severity is non-null in the schema but unknown pre-classification;
          // LOW is the placeholder for never-classified rows.
          severity: "LOW",
          status: "DUPLICATE",
          duplicateOfId: match.id,
          embedding,
        },
        select: { id: true },
      });
      // Live update: duplicate written, no classification job needed.
      await publishIncident(incident.id);
      return NextResponse.json(
        {
          incidentId: incident.id,
          status: "DUPLICATE",
          duplicateOf: match.id,
          similarity: Number(match.similarity.toFixed(4)),
        },
        { status: 200 }
      );
    }

    // New incident: insert OPEN + enqueue CLASSIFY atomically — never an
    // incident without its job or a job without its incident.
    const { incident, job } = await prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          ...normalized,
          severity: "LOW", // placeholder until the worker classifies
          status: "OPEN",
          embedding,
        },
        select: { id: true },
      });
      const job = await enqueue("CLASSIFY", { incidentId: incident.id }, tx);
      return { incident, job };
    });

    // Live update: new OPEN incident (dashboard shows it as pending
    // classification; the worker will emit again once classified).
    await publishIncident(incident.id);

    return NextResponse.json(
      { incidentId: incident.id, status: "OPEN", jobId: job.id },
      { status: 200 }
    );
  } catch (e) {
    // Two concurrent deliveries of the same event can both pass the
    // findUnique check; the unique constraint on externalId settles it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ duplicateDelivery: true }, { status: 200 });
    }
    console.error("webhook processing failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
