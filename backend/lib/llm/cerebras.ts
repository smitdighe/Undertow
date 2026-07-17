import { buildClassifyMessages } from "@/lib/llm/prompts/classify";
import { parseClassification } from "@/lib/llm/parse";
import {
  Classification,
  LLMProviderError,
  LLMRateLimitError,
} from "@/lib/llm/types";

const PROVIDER = "cerebras" as const;
// Spec called for Llama 3.1 70B, but it is no longer served on this Cerebras
// account (models list: gemma-4-31b, zai-glm-4.7, gpt-oss-120b). Using the most
// capable available model; change here if a Llama 70B becomes accessible.
const MODEL = "gpt-oss-120b";
const ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";
const TIMEOUT_MS = 10_000;

/**
 * Drop-in replacement for classifyWithGroq — identical signature and return
 * type. Calls Cerebras (Llama 3.1 70B) over its OpenAI-compatible endpoint.
 * Throws LLMRateLimitError on 429, LLMProviderError on anything else.
 */
export async function classifyWithCerebras(
  title: string,
  body: string
): Promise<Classification> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new LLMProviderError(PROVIDER, "unknown", "CEREBRAS_API_KEY is not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildClassifyMessages(title, body),
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new LLMProviderError(PROVIDER, "timeout", "cerebras request timed out");
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new LLMProviderError(PROVIDER, "unknown", message);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new LLMRateLimitError(PROVIDER, "cerebras rate limited", 429);
    }
    throw new LLMProviderError(
      PROVIDER,
      "http",
      `cerebras HTTP ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    );
  }

  let content: string | null = null;
  try {
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    content = data.choices?.[0]?.message?.content ?? null;
  } catch {
    throw new LLMProviderError(PROVIDER, "parse", "cerebras response was not valid JSON envelope");
  }

  return parseClassification(PROVIDER, content);
}
