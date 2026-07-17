// GET /api/incidents and POST /api/incidents/[id]/correct.
import { apiFetch } from "./client";
import { paginatedSchema, type Paginated } from "@/types/api";
import {
  incidentSchema,
  correctionResultSchema,
  type Incident,
  type CorrectionInput,
  type CorrectionResult,
  type Severity,
  type Status,
} from "@/types/incident";

const incidentsPageSchema = paginatedSchema(incidentSchema);

export interface ListIncidentsParams {
  status?: Status;
  severity?: Severity;
  /** Backend clamps to 1..100 and 400s outside it; default 20. */
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

/** GET /api/incidents — offset pagination, optional status/severity filters. */
export async function listIncidents(
  params: ListIncidentsParams = {}
): Promise<Paginated<Incident>> {
  const { status, severity, limit, offset, signal } = params;
  return apiFetch("/api/incidents", {
    schema: incidentsPageSchema,
    query: { status, severity, limit, offset },
    signal,
  });
}

/**
 * POST /api/incidents/[id]/correct — ONCALL only.
 *
 * Throws ApiError 403 for a VIEWER and 401 when unauthenticated; callers should
 * branch on those rather than showing a generic failure (isForbidden/isUnauthorized).
 */
export async function correctIncident(
  incidentId: string,
  input: CorrectionInput,
  signal?: AbortSignal
): Promise<CorrectionResult> {
  return apiFetch(`/api/incidents/${encodeURIComponent(incidentId)}/correct`, {
    schema: correctionResultSchema,
    method: "POST",
    body: input,
    signal,
  });
}
