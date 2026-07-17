import { Prisma, PrismaClient, type Job, type JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ClaimedJob, JobPayloadMap } from "@/lib/jobs/types";

export const MAX_ATTEMPTS = 3;
/** A retried (failed) job only becomes claimable again after this delay. */
export const RETRY_BACKOFF_SECONDS = 30;
/**
 * A CLAIMED job older than this is considered orphaned (worker died between
 * CLAIMED and DONE) and becomes reclaimable. Must be comfortably larger than
 * the longest legitimate job (LLM classify worst case ~25s with fallback), or
 * a slow-but-alive worker could have its job stolen and double-processed.
 */
export const ORPHAN_TIMEOUT_SECONDS = 300;

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Insert a new PENDING job. Accepts an optional transaction client so callers
 * can enqueue atomically with other writes (e.g. Incident insert + CLASSIFY
 * job in one transaction — no incident left OPEN with no job if one write fails).
 */
export function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloadMap[T],
  client: DbClient = prisma
): Promise<Job> {
  return client.job.create({
    data: { type, payload, status: "PENDING" },
  });
}

/**
 * Atomically claim exactly one job, safe under concurrent workers.
 *
 * Single SQL statement: the FOR UPDATE SKIP LOCKED subquery selects and
 * row-locks the oldest claimable job; a concurrent claimNext() skips the
 * locked row and takes the next one (or none). SELECT-then-UPDATE as two
 * statements would let two workers read the same PENDING row before either
 * updates it (TOCTOU) — this formulation makes that impossible.
 *
 * Claimable =
 *   PENDING and (never claimed, or last claim attempt > RETRY_BACKOFF ago)
 *     — the backoff stops a crashing job from being retried in a hot loop
 *   OR CLAIMED and claimedAt > ORPHAN_TIMEOUT ago
 *     — self-healing reclaim of jobs orphaned by a dead worker.
 *
 * Returns the claimed job or null if nothing is claimable.
 */
export async function claimNext(): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job"
    SET "status" = 'CLAIMED'::"JobStatus", "claimedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE (
        (
          "status" = 'PENDING'::"JobStatus"
          AND (
            "claimedAt" IS NULL
            OR "claimedAt" < now() - make_interval(secs => ${RETRY_BACKOFF_SECONDS})
          )
        )
        OR (
          "status" = 'CLAIMED'::"JobStatus"
          AND "claimedAt" < now() - make_interval(secs => ${ORPHAN_TIMEOUT_SECONDS})
        )
      )
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type"::text AS "type", "payload", "status"::text AS "status",
              "attempts", "claimedAt", "createdAt"
  `;
  return rows[0] ?? null;
}

/** Mark a job DONE. */
export function complete(jobId: string): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId },
    data: { status: "DONE" },
  });
}

/**
 * Record a processing failure. Single atomic statement (no read-modify-write
 * race): increments attempts, and either parks the job as FAILED (attempts
 * exhausted — manual review) or resets it to PENDING for retry. claimedAt is
 * deliberately kept: the claim query's backoff filter reads it, so the retry
 * only becomes claimable after RETRY_BACKOFF_SECONDS.
 */
export async function fail(
  jobId: string
): Promise<{ id: string; attempts: number; status: string } | null> {
  const rows = await prisma.$queryRaw<
    { id: string; attempts: number; status: string }[]
  >`
    UPDATE "Job"
    SET "attempts" = "attempts" + 1,
        "status" = CASE
          WHEN "attempts" + 1 >= ${MAX_ATTEMPTS}
            THEN 'FAILED'::"JobStatus"
          ELSE 'PENDING'::"JobStatus"
        END
    WHERE "id" = ${jobId}
    RETURNING "id", "attempts", "status"::text AS "status"
  `;
  return rows[0] ?? null;
}

/**
 * Explicit orphan sweep: flip stale CLAIMED jobs back to PENDING so ordinary
 * claims pick them up. The claim query already treats stale CLAIMED rows as
 * claimable (self-healing even if this sweep never runs); this exists for
 * detection/observability — callers should log the returned ids.
 */
export async function recoverOrphans(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Job"
    SET "status" = 'PENDING'::"JobStatus"
    WHERE "status" = 'CLAIMED'::"JobStatus"
      AND "claimedAt" < now() - make_interval(secs => ${ORPHAN_TIMEOUT_SECONDS})
    RETURNING "id"
  `;
  return rows.map((r) => r.id);
}
