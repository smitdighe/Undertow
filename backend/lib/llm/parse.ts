import {
  Classification,
  classificationSchema,
  LLMProvider,
  LLMProviderError,
} from "@/lib/llm/types";

/** Strip accidental ```json fences the model may add despite instructions. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Parse raw model output into a validated Classification. Any malformed JSON or
 * schema violation throws LLMProviderError(code="parse") so the router treats it
 * exactly like any other provider failure and falls through — never accepting
 * invalid data.
 */
export function parseClassification(
  provider: LLMProvider,
  raw: string | null | undefined
): Classification {
  if (!raw) {
    throw new LLMProviderError(provider, "parse", "empty model response");
  }

  let json: unknown;
  try {
    json = JSON.parse(stripFences(raw));
  } catch {
    throw new LLMProviderError(provider, "parse", "response was not valid JSON");
  }

  const result = classificationSchema.safeParse(json);
  if (!result.success) {
    throw new LLMProviderError(
      provider,
      "parse",
      `response failed schema validation: ${result.error.message}`
    );
  }
  return result.data;
}
