import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { buildJudgePrompt, type JudgeInput } from "@/lib/llm/prompts/judge";
import { LLMProviderError, LLMRateLimitError } from "@/lib/llm/types";

const PROVIDER = "gemini" as const;
// Gemini 2.0 Flash is the intended model; GEMINI_MODEL overrides it when that
// model has no quota on a given account (e.g. "gemini-flash-latest").
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
// The judge runs in a batch eval, not a request path — a longer budget than the
// 10s classify timeout is fine, but it must still be bounded.
const TIMEOUT_MS = 20_000;

export const judgeVerdictSchema = z.object({
  reasonable: z.boolean(),
  rationale: z.string().min(1),
});
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new LLMProviderError(PROVIDER, "unknown", "GEMINI_API_KEY is not set");
  }
  return new GoogleGenerativeAI(apiKey);
}

/** Bound any Gemini call — the SDK has no built-in per-request timeout here. */
async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new LLMProviderError(PROVIDER, "timeout", `${label} timed out`)),
      TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function normalizeGeminiError(err: unknown, label: string): Error {
  if (err instanceof LLMProviderError || err instanceof LLMRateLimitError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // The SDK surfaces status in the message text (e.g. "[429 Too Many Requests]").
  if (message.includes("429")) {
    return new LLMRateLimitError(PROVIDER, `gemini rate limited during ${label}`);
  }
  return new LLMProviderError(PROVIDER, "unknown", `${label}: ${message}`);
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Judge whether a classifier's answer for one field was reasonable, given the
 * incident and the human's correction. Used by the eval harness for borderline
 * disagreements instead of a strict string-equality fail.
 *
 * Throws on failure — the caller is expected to fall back to strict comparison
 * for that case rather than abandoning the whole eval run.
 */
export async function judgeClassification(input: JudgeInput): Promise<JudgeVerdict> {
  const model = client().getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  });

  let text: string;
  try {
    const res = await withTimeout(
      model.generateContent(buildJudgePrompt(input)),
      "judge"
    );
    text = res.response.text();
  } catch (err) {
    throw normalizeGeminiError(err, "judge");
  }

  let json: unknown;
  try {
    json = JSON.parse(stripFences(text));
  } catch {
    throw new LLMProviderError(PROVIDER, "parse", "judge response was not valid JSON");
  }

  const parsed = judgeVerdictSchema.safeParse(json);
  if (!parsed.success) {
    throw new LLMProviderError(
      PROVIDER,
      "parse",
      `judge response failed schema validation: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

export interface DraftInput {
  title: string;
  body: string;
  severity: string;
  suggestedTeam: string;
}

/**
 * Draft a longer, more thorough incident response than the terse draftResponse
 * produced on the latency-sensitive Groq/Cerebras classify path. Returns plain
 * prose (no JSON envelope).
 */
export async function draftIncidentResponse(input: DraftInput): Promise<string> {
  const model = client().getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0.4 },
  });

  const prompt = `You are an on-call engineer writing a thorough public update for an incident.

Incident title: ${input.title}

Incident body:
${input.body}

Assessed severity: ${input.severity}
Owning team: ${input.suggestedTeam}

Write an incident response update covering:
1. What we know and the current customer-facing impact.
2. What we are actively doing about it.
3. What the reporter/customer should expect next, including a rough update cadence.

Write 3-5 short paragraphs in plain prose. No markdown headings, no bullet lists, no preamble — start directly with the update.`;

  try {
    const res = await withTimeout(model.generateContent(prompt), "draft");
    const text = res.response.text().trim();
    if (!text) {
      throw new LLMProviderError(PROVIDER, "parse", "draft response was empty");
    }
    return text;
  } catch (err) {
    throw normalizeGeminiError(err, "draft");
  }
}
