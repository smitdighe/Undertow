import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { requireOncall, RbacError } from "@/lib/auth/rbac";
import { SEVERITY_VALUES } from "@/lib/llm/types";
import { publishIncident } from "@/lib/sse/bus";

export const runtime = "nodejs";

// Only these logical fields are correctable; each maps to a real Incident
// column below. A `field` outside this enum is rejected by zod before any
// write, so a bad field name can never touch the DB.
const bodySchema = z.object({
  field: z.enum(["severity", "team", "duplicate"]),
  correctedValue: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // --- AuthZ: ONCALL only. VIEWER / unauthenticated -> 403/401, never a crash.
  try {
    const session = await getServerSession(authOptions);
    requireOncall(session);

    const incidentId = params.id;

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { field, correctedValue } = parsed.data;

    // Field-specific value validation before writing anything.
    if (field === "severity" && !SEVERITY_VALUES.includes(correctedValue as never)) {
      return NextResponse.json(
        { error: `severity must be one of ${SEVERITY_VALUES.join(", ")}` },
        { status: 400 }
      );
    }
    if (field === "duplicate" && correctedValue === incidentId) {
      return NextResponse.json(
        { error: "an incident cannot be a duplicate of itself" },
        { status: 400 }
      );
    }

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      return NextResponse.json({ error: "incident not found" }, { status: 404 });
    }

    // Current value becomes the Correction's originalValue.
    const originalValue =
      field === "severity"
        ? incident.severity
        : field === "team"
          ? (incident.suggestedTeam ?? "")
          : (incident.duplicateOfId ?? "");

    // Build the Incident update. Marking a duplicate also flips status and
    // must go through the relation (`connect`), not the raw FK scalar.
    const incidentData: Prisma.IncidentUpdateInput =
      field === "severity"
        ? { severity: correctedValue as (typeof SEVERITY_VALUES)[number] }
        : field === "team"
          ? { suggestedTeam: correctedValue }
          : { duplicateOf: { connect: { id: correctedValue } }, status: "DUPLICATE" };

    try {
      const [, updated] = await prisma.$transaction([
        prisma.correction.create({
          data: {
            incidentId,
            userId: session!.user.id,
            field,
            originalValue,
            correctedValue,
          },
        }),
        prisma.incident.update({
          where: { id: incidentId },
          data: incidentData,
          select: {
            id: true,
            severity: true,
            status: true,
            suggestedTeam: true,
            duplicateOfId: true,
          },
        }),
      ]);

      // Push the change to the live dashboard.
      await publishIncident(incidentId);

      return NextResponse.json({ ok: true, field, originalValue, correctedValue, incident: updated });
    } catch (e) {
      // duplicate correction pointing at a non-existent incident: `connect`
      // fails with P2025 (related record not found); P2003 covers a raw FK
      // violation just in case.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2025" || e.code === "P2003")
      ) {
        return NextResponse.json(
          { error: "duplicate target incident does not exist" },
          { status: 400 }
        );
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("correction failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
