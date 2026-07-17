import { classifyWithGroq } from "@/lib/llm/groq";
import { classifyWithCerebras } from "@/lib/llm/cerebras";
import { Classification, LLMError, LLMProvider } from "@/lib/llm/types";

export interface ClassificationResult {
  data: Classification;
  /** Which provider actually served the request — for eval/observability. */
  provider: LLMProvider;
}

/** Thrown when every provider in the fallback chain fails. */
export class AllProvidersFailedError extends Error {
  errors: unknown[];
  constructor(errors: unknown[]) {
    super("all LLM providers failed to classify the incident");
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

function describe(err: unknown): string {
  if (err instanceof LLMError) {
    return `${err.provider}:${err.code}${err.status ? `(${err.status})` : ""} ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Classify an incident: try Groq first, and on ANY failure (rate limit,
 * malformed/invalid JSON, timeout, other error) retry exactly once against
 * Cerebras with the identical prompt. Throws AllProvidersFailedError if both
 * fail so the caller can mark the incident for manual review.
 */
export async function classify(
  title: string,
  body: string
): Promise<ClassificationResult> {
  const failures: unknown[] = [];

  try {
    const data = await classifyWithGroq(title, body);
    console.info(JSON.stringify({ event: "llm.classify", provider: "groq", status: "ok" }));
    return { data, provider: "groq" };
  } catch (err) {
    failures.push(err);
    const rateLimited = err instanceof LLMError && err.code === "rate_limit";
    console.warn(
      JSON.stringify({
        event: "llm.classify",
        provider: "groq",
        status: "failed",
        rateLimited,
        reason: describe(err),
        action: "falling_back_to_cerebras",
      })
    );
  }

  try {
    const data = await classifyWithCerebras(title, body);
    console.info(
      JSON.stringify({ event: "llm.classify", provider: "cerebras", status: "ok", viaFallback: true })
    );
    return { data, provider: "cerebras" };
  } catch (err) {
    failures.push(err);
    console.error(
      JSON.stringify({
        event: "llm.classify",
        provider: "cerebras",
        status: "failed",
        reason: describe(err),
      })
    );
  }

  throw new AllProvidersFailedError(failures);
}
