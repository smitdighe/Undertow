import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { assertRequiredEnv, MissingEnvError, REQUIRED_EVAL_ENV } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER = "x-cron-secret";

/** Constant-time secret comparison — `===` leaks the matching prefix length. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Length is compared first because timingSafeEqual throws on mismatch. This
  // leaks only the secret's length, not its contents.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /api/cron/eval — scheduled eval trigger.
 *
 * Enqueues an EVAL job and returns 202 immediately; the worker runs it with the
 * queue's retry/backoff semantics. The eval takes minutes, which would blow
 * past serverless request limits if run inline here. Poll
 * GET /api/cron/eval/{jobId} for the result.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SHARED_SECRET;
  if (!expected) {
    console.error("CRON_SHARED_SECRET is not set");
    return NextResponse.json({ error: "cron not configured" }, { status: 500 });
  }

  // Wrong/missing secret: reject before doing any work.
  if (!secretMatches(req.headers.get(HEADER), expected)) {
    console.warn(JSON.stringify({ event: "cron.eval.unauthorized" }));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fail fast: refuse to enqueue a job the worker provably cannot process.
  // Runs after auth so unauthenticated callers learn nothing about config.
  try {
    assertRequiredEnv(REQUIRED_EVAL_ENV);
  } catch (err) {
    if (err instanceof MissingEnvError) {
      console.error(JSON.stringify({ event: "cron.eval.misconfigured", missing: err.missing }));
      return NextResponse.json(
        { error: err.message, missing: err.missing },
        { status: 500 }
      );
    }
    throw err;
  }

  try {
    const job = await enqueue("EVAL", {});
    console.info(JSON.stringify({ event: "cron.eval.enqueued", jobId: job.id }));
    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
        status: job.status,
        statusUrl: `/api/cron/eval/${job.id}`,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("cron eval enqueue failed:", err);
    return NextResponse.json({ error: "failed to enqueue eval job" }, { status: 500 });
  }
}
