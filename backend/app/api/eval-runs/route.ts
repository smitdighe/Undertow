import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { requireRole, RbacError } from "@/lib/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/eval-runs?limit=&cursor= — paginated EvalRun history, newest first.
 *
 * The single highest-value gap the frontend was already written against
 * (lib/api/evalRuns.ts listEvalRuns / listEvalRunsOrNull, types/evalRun.ts
 * evalRunsPageSchema). Shipping it takes /admin/metrics out of degraded mode:
 * the drift chart's rolling average and gate line need real history, not the
 * single ?jobId= run the page falls back to while this route 404s.
 *
 * AuthZ: any authenticated user (VIEWER is the floor; ONCALL satisfies it as a
 * superset). Eval scores are not public — the cron routes gate them behind a
 * shared secret, and /admin/metrics itself is behind the auth middleware — so
 * reading the history requires a session. No session -> 401, matching the
 * frontend hook (useEvalHistory) which already distinguishes 401 from a 404.
 */

// limit: the frontend requests 50 (PAGE_LIMIT); cap at 100 so a hand-crafted
// request can't ask for an unbounded page.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

/**
 * Keyset (seek) pagination cursor. Ordering is (createdAt desc, id desc); the
 * cursor carries both halves of that compound key so paging is deterministic
 * even when two runs share a createdAt. Opaque base64url to callers — they only
 * ever echo back the nextCursor we hand them.
 */
interface Cursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(run: { createdAt: Date; id: string }): string {
  return Buffer.from(`${run.createdAt.toISOString()}|${run.id}`, "utf8").toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  // ISO timestamps and cuids both never contain "|", so a single split is safe.
  const sep = decoded.indexOf("|");
  if (sep === -1) return null;
  const iso = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  const createdAt = new Date(iso);
  if (!id || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

export async function GET(req: NextRequest) {
  try {
    // Session required; VIEWER is the floor and ONCALL satisfies it.
    const session = await getServerSession(authOptions);
    requireRole(session, Role.VIEWER);

    const sp = req.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      limit: sp.get("limit") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { limit } = parsed.data;

    let cursor: Cursor | null = null;
    if (parsed.data.cursor !== undefined) {
      cursor = decodeCursor(parsed.data.cursor);
      if (!cursor) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    // Seek strictly past the cursor row in (createdAt desc, id desc) order.
    const where: Prisma.EvalRunWhereInput = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {};

    // Fetch one extra row to learn whether another page exists without a count().
    const rows = await prisma.evalRun.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        precision: true,
        recall: true,
        f1: true,
        sampleSize: true,
        driftFlag: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    // createdAt (Date) serialises to an ISO string, matching evalRunSchema's
    // `createdAt: z.string()` on the client.
    return NextResponse.json({ runs: page, nextCursor });
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("eval-runs list failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
