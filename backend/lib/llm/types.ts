import { z } from "zod";

/** Severity values mirror the Prisma `Severity` enum. */
export const SEVERITY_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const classificationSchema = z.object({
  severity: z.enum(SEVERITY_VALUES),
  suggestedTeam: z.string().min(1),
  draftResponse: z.string().min(1),
});

export type Classification = z.infer<typeof classificationSchema>;

export type LLMProvider = "groq" | "cerebras" | "gemini";

/** Common signature every provider client implements — drop-in swappable. */
export type ClassifyFn = (title: string, body: string) => Promise<Classification>;

// ---- Typed errors so the router can distinguish rate-limit from real failures.

export type LLMErrorCode = "rate_limit" | "timeout" | "parse" | "http" | "unknown";

export class LLMError extends Error {
  provider: LLMProvider;
  code: LLMErrorCode;
  status?: number;
  constructor(
    provider: LLMProvider,
    code: LLMErrorCode,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "LLMError";
    this.provider = provider;
    this.code = code;
    this.status = status;
  }
}

/** HTTP 429 / provider-signalled rate limiting. */
export class LLMRateLimitError extends LLMError {
  constructor(provider: LLMProvider, message = "rate limited", status = 429) {
    super(provider, "rate_limit", message, status);
    this.name = "LLMRateLimitError";
  }
}

/** Any other provider failure: non-2xx, timeout, malformed/invalid JSON. */
export class LLMProviderError extends LLMError {
  constructor(
    provider: LLMProvider,
    code: Exclude<LLMErrorCode, "rate_limit">,
    message: string,
    status?: number
  ) {
    super(provider, code, message, status);
    this.name = "LLMProviderError";
  }
}
