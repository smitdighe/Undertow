import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SEVERITY_VALUES } from "@/lib/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_VALUES = ["OPEN", "DUPLICATE", "RESOLVED", "ESCALATED"] as const;

const querySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/incidents — offset pagination + optional status/severity filters. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    status: sp.get("status") ?? undefined,
    severity: sp.get("severity") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    offset: sp.get("offset") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { status, severity, limit, offset } = parsed.data;
  const where: Prisma.IncidentWhereInput = {};
  if (status) where.status = status;
  if (severity) where.severity = severity;

  const [total, data] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      // Exclude the embedding — large and not useful to API consumers.
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
    }),
  ]);

  return NextResponse.json({
    data,
    pagination: { total, limit, offset, hasMore: offset + data.length < total },
  });
}
