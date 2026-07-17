// Incident shapes. zod schema is the single source of truth; the TS types below
// are inferred from it (z.infer) so the two can never drift apart.
//
// Grounded in backend/prisma/schema.prisma and verified against live API responses.
import { z } from "zod";

/** Mirrors the Prisma `Severity` enum. */
export const SEVERITY_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
/** Mirrors the Prisma `Status` enum. */
export const STATUS_VALUES = ["OPEN", "DUPLICATE", "RESOLVED", "ESCALATED"] as const;

export const severitySchema = z.enum(SEVERITY_VALUES);
export const statusSchema = z.enum(STATUS_VALUES);

/**
 * NOT nullable, deliberately.
 *
 * `severity Severity` has no `?` in the Prisma schema, and the webhook inserts a
 * literal "LOW" placeholder pre-classification (see backend/app/api/webhook/route.ts:73
 * — "severity is non-null in the schema but unknown pre-classification"). A live
 * sample of 29 incidents contained zero nulls.
 *
 * Consequence worth knowing: severity alone cannot tell "unclassified" from a real
 * LOW. `suggestedTeam`/`draftResponse` being null is the only honest signal of a
 * pending classification — those two ARE nullable in the schema and in live data.
 */
export const incidentSchema = z.object({
  id: z.string(),
  source: z.string(),
  externalId: z.string(),
  title: z.string(),
  body: z.string(),
  severity: severitySchema,
  status: statusSchema,
  duplicateOfId: z.string().nullable(),
  suggestedTeam: z.string().nullable(),
  draftResponse: z.string().nullable(),
  // Wire format: ISO-8601 from Prisma's Date serialisation. Kept as a string so the
  // type matches what the transport actually carries; parse at the render edge.
  createdAt: z.string(),
});

export type Severity = z.infer<typeof severitySchema>;
export type Status = z.infer<typeof statusSchema>;
export type Incident = z.infer<typeof incidentSchema>;

// --- Corrections -------------------------------------------------------------

/** The correctable fields, mirroring the backend's own bodySchema enum. */
export const CORRECTION_FIELDS = ["severity", "team", "duplicate"] as const;
export const correctionFieldSchema = z.enum(CORRECTION_FIELDS);

/** Request body for POST /api/incidents/[id]/correct. */
export const correctionInputSchema = z.object({
  field: correctionFieldSchema,
  correctedValue: z.string().min(1),
});

/**
 * Response from a successful correction. Note this is NOT a Correction row: the
 * route returns an envelope plus the updated Incident subset it selected.
 */
export const correctionResultSchema = z.object({
  ok: z.literal(true),
  field: correctionFieldSchema,
  originalValue: z.string(),
  correctedValue: z.string(),
  incident: z.object({
    id: z.string(),
    severity: severitySchema,
    status: statusSchema,
    suggestedTeam: z.string().nullable(),
    duplicateOfId: z.string().nullable(),
  }),
});

export type CorrectionField = z.infer<typeof correctionFieldSchema>;
export type CorrectionInput = z.infer<typeof correctionInputSchema>;
export type CorrectionResult = z.infer<typeof correctionResultSchema>;
