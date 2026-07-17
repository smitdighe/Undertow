"use client";

// Submit flow for POST /api/incidents/[id]/correct.
//
// Client-side role hiding is a hint, not the gate — the server 403s a VIEWER no
// matter what the UI showed. A 403 here most likely means the session's role is
// stale (changed since login), so we resync the session store and say so.
import { useCallback, useState } from "react";
import { correctIncident } from "@/lib/api/incidents";
import { ApiError, ApiNetworkError, ApiSchemaError } from "@/lib/api/client";
import type { CorrectionInput, CorrectionResult } from "@/types/incident";
import { useIncidentStore } from "@/store/incidentStore";
import { useSessionStore } from "@/store/sessionStore";

export function useCorrection(incidentId: string | null) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setSubmitting(false);
  }, []);

  const submit = useCallback(
    async (input: CorrectionInput): Promise<CorrectionResult | null> => {
      if (!incidentId || submitting) return null;
      setSubmitting(true);
      setError(null);

      try {
        const result = await correctIncident(incidentId, input);
        // Apply the server's authoritative subset immediately; the SSE echo of
        // this same change merges by id moments later (idempotent, no dup).
        useIncidentStore.getState().applyCorrection(result.incident);
        return result;
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setError("Corrections need the on-call role. Your session may be out of date.");
          // Resync so the UI stops offering actions the server will refuse.
          void useSessionStore.getState().hydrate();
        } else if (e instanceof ApiError && e.status === 401) {
          setError("Your session expired. Log in again.");
        } else if (e instanceof ApiError && e.status === 400) {
          // The route's 400s are specific and readable (bad severity value,
          // self-duplicate, missing target) — surface them as-is.
          setError(e.body?.error ?? "The server rejected that correction.");
        } else if (e instanceof ApiError && e.status === 404) {
          setError("That incident no longer exists.");
        } else if (e instanceof ApiNetworkError) {
          setError("Can't reach the server. Check your connection and try again.");
        } else if (e instanceof ApiSchemaError) {
          setError("The server answered in an unexpected shape. Refresh and retry.");
        } else {
          setError("Correction failed. Try again.");
        }
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [incidentId, submitting]
  );

  return { submit, submitting, error, reset };
}
