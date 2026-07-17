import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER = "x-cron-secret";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * GET /api/cron/eval/{jobId} — lightweight status poll for an enqueued EVAL
 * job. Returns the job's queue status, and once DONE, the recorded result plus
 * the EvalRun row it produced.
 *
 * Guarded by the same shared secret as the trigger — eval scores are not public.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const expected = process.env.CRON_SHARED_SECRET;
  if (!expected) {
    console.error("CRON_SHARED_SECRET is not set");
    return NextResponse.json({ error: "cron not configured" }, { status: 500 });
  }
  if (!secretMatches(req.headers.get(HEADER), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      result: true,
      claimedAt: true,
      createdAt: true,
    },
  });

  if (!job || job.type !== "EVAL") {
    return NextResponse.json({ error: "eval job not found" }, { status: 404 });
  }

  // `done` lets a poller stop on either terminal state without knowing the
  // queue's status vocabulary.
  const done = job.status === "DONE" || job.status === "FAILED";

  const result = (job.result ?? null) as { evalRunId?: string | null } | null;
  const evalRunId = result?.evalRunId ?? null;
  const evalRun = evalRunId
    ? await prisma.evalRun.findUnique({ where: { id: evalRunId } })
    : null;

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    done,
    attempts: job.attempts,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt,
    result: job.result ?? null,
    evalRun,
  });
}
