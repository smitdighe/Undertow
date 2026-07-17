import Groq from "groq-sdk";
import { buildClassifyMessages } from "@/lib/llm/prompts/classify";
import { parseClassification } from "@/lib/llm/parse";
import {
  Classification,
  LLMProviderError,
  LLMRateLimitError,
} from "@/lib/llm/types";

const PROVIDER = "groq" as const;
const MODEL = "llama-3.3-70b-versatile";
const TIMEOUT_MS = 10_000;

/**
 * Classify an incident with Groq (Llama 3.3 70B), requesting JSON output and
 * validating against the classification schema.
 * Throws LLMRateLimitError on 429, LLMProviderError on anything else.
 */
export async function classifyWithGroq(
  title: string,
  body: string
): Promise<Classification> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new LLMProviderError(PROVIDER, "unknown", "GROQ_API_KEY is not set");
  }

  const client = new Groq({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });

  let content: string | null;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: buildClassifyMessages(title, body),
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 800,
    });
    content = completion.choices[0]?.message?.content ?? null;
  } catch (err) {
    throw normalizeGroqError(err);
  }

  return parseClassification(PROVIDER, content);
}

function normalizeGroqError(err: unknown): Error {
  const status = (err as { status?: number })?.status;
  if (status === 429) {
    return new LLMRateLimitError(PROVIDER, "groq rate limited", 429);
  }
  // Timeouts and connection errors surface as APIConnection* errors.
  const name = (err as { name?: string })?.name ?? "";
  if (name.includes("Timeout")) {
    return new LLMProviderError(PROVIDER, "timeout", "groq request timed out");
  }
  const message = err instanceof Error ? err.message : String(err);
  return new LLMProviderError(PROVIDER, status ? "http" : "unknown", message, status);
}
