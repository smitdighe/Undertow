import type { Metadata } from "next";
import { EvalMetrics } from "@/features/eval-metrics";
import {
  apiFetch,
  serverApiBaseUrl,
  ApiError,
  ApiNetworkError,
  ApiSchemaError,
  isNotFound,
} from "@/lib/api/client";
import { evalJobStatusSchema } from "@/types/job";
import type { EvalRun } from "@/types/evalRun";

export const metadata: Metadata = {
  title: "Undertow — Classifier eval",
};

// Reads searchParams and the cron route on every request.
export const dynamic = "force-dynamic";

// Route protection lives in middleware.ts (/admin/:path* getToken redirect).

interface Fallback {
  run: EvalRun | null;
  note: string | null;
}

/**
 * Resolve the single-run fallback used when GET /api/eval-runs 404s.
 *
 * This runs server-side for two reasons. The cron route authenticates with
 * CRON_SHARED_SECRET, which must never reach the browser (Phase 5's evalRuns.ts
 * enforces that with an assertServerOnly guard). And there is no route that lists
 * job ids, so the id has to be supplied explicitly via ?jobId= — inventing one, or
 * triggering a fresh eval to manufacture one, would be fabricating data and
 * spending LLM credits on a page load.
 *
 * The secret is used here and never serialised into the response: only the
 * resulting EvalRun and a human-readable note cross to the client.
 */
async function resolveFallback(jobId: string | undefined): Promise<Fallback> {
  if (!jobId) return { run: null, note: null };

  const secret = process.env.CRON_SHARED_SECRET;
  const baseUrl = serverApiBaseUrl();

  if (!secret) {
    return {
      run: null,
      note: "A job id was supplied, but this app has no CRON_SHARED_SECRET configured, so the eval job route can't be read.",
    };
  }
  if (!baseUrl) {
    return { run: null, note: "A job id was supplied, but BACKEND_URL isn't configured." };
  }

  try {
    // Goes through apiFetch like every other call: `baseUrl` supplies the absolute
    // origin Node needs, and the typed client owns request building, status/shape
    // validation and error classification.
    const job = await apiFetch(`/api/cron/eval/${encodeURIComponent(jobId)}`, {
      schema: evalJobStatusSchema,
      headers: { "x-cron-secret": secret },
      baseUrl,
      // Explicit, so this never depends on the route's `dynamic` setting to imply it.
      cache: "no-store",
    });

    if (!job.evalRun) {
      return {
        run: null,
        note:
          job.status === "FAILED"
            ? "That eval job failed, so it recorded no run."
            : `That eval job is ${job.status} — no result recorded yet.`,
      };
    }

    return { run: job.evalRun, note: null };
  } catch (error) {
    // Same notes as before, now driven by apiFetch's typed errors instead of
    // hand-read status codes.
    if (isNotFound(error)) return { run: null, note: "No eval job matches that job id." };
    if (error instanceof ApiSchemaError) {
      return { run: null, note: "The eval job response didn't match the expected shape." };
    }
    if (error instanceof ApiNetworkError) {
      return { run: null, note: "Couldn't reach the backend to read that eval job." };
    }
    if (error instanceof ApiError) {
      return { run: null, note: `Reading that eval job failed (HTTP ${error.status}).` };
    }
    return { run: null, note: "Couldn't reach the backend to read that eval job." };
  }
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: { jobId?: string };
}) {
  const { run, note } = await resolveFallback(searchParams.jobId);
  return <EvalMetrics fallbackRun={run} fallbackNote={note} />;
}
