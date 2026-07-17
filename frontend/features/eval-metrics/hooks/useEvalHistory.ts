"use client";

// Loads eval-run history via Phase 5's listEvalRunsOrNull, which resolves to null
// on a 404 (the history route is a documented contract the backend hasn't shipped)
// and throws on every other failure, so a real outage never masquerades as
// "not built yet".
import { useCallback, useEffect, useRef, useState } from "react";
import { listEvalRunsOrNull } from "@/lib/api/evalRuns";
import { ApiError, ApiNetworkError, ApiSchemaError } from "@/lib/api/client";
import type { EvalRun } from "@/types/evalRun";

/** Where the rendered data came from — drives the inline provenance note. */
export type EvalDataSource =
  /** GET /api/eval-runs answered: real trend data. */
  | "history"
  /** History route 404'd; showing one run resolved server-side from a jobId. */
  | "single-job"
  /** History route 404'd and no single run was available: nothing to plot. */
  | "none";

export type EvalHistoryStatus = "loading" | "ready" | "error";

interface UseEvalHistoryResult {
  status: EvalHistoryStatus;
  runs: EvalRun[];
  source: EvalDataSource;
  error: string | null;
  reload: () => void;
}

const PAGE_LIMIT = 50;

export function useEvalHistory(fallbackRun: EvalRun | null): UseEvalHistoryResult {
  const [status, setStatus] = useState<EvalHistoryStatus>("loading");
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [source, setSource] = useState<EvalDataSource>("none");
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const page = await listEvalRunsOrNull({ limit: PAGE_LIMIT });
      if (!aliveRef.current) return;

      if (page) {
        setRuns(page.runs);
        setSource("history");
        setStatus("ready");
        return;
      }

      // 404: the route isn't there yet. Degrade to the single run the server
      // resolved from ?jobId=, if any. Never invent history to fill the gap.
      setRuns(fallbackRun ? [fallbackRun] : []);
      setSource(fallbackRun ? "single-job" : "none");
      setStatus("ready");
    } catch (e) {
      if (!aliveRef.current) return;
      // A genuine failure — distinct from the route being absent.
      if (e instanceof ApiNetworkError) {
        setError("Can't reach the server. Check your connection and retry.");
      } else if (e instanceof ApiError && e.status === 401) {
        setError("Your session expired. Log in again.");
      } else if (e instanceof ApiError && e.status === 403) {
        setError("Your account can't read eval history.");
      } else if (e instanceof ApiSchemaError) {
        setError("The eval history response didn't match the expected shape.");
      } else if (e instanceof ApiError) {
        setError(`Couldn't load eval history (HTTP ${e.status}).`);
      } else {
        setError("Couldn't load eval history.");
      }
      setStatus("error");
    }
  }, [fallbackRun]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  return { status, runs, source, error, reload: load };
}

export default useEvalHistory;
