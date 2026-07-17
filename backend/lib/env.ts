/**
 * Fail-fast environment validation.
 *
 * Without this, a missing key surfaces deep inside a call as a generic error
 * (e.g. "GROQ_API_KEY is not set" thrown mid-classify, after a job was already
 * claimed). Validating up front names every missing variable at once.
 */
export class MissingEnvError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Missing required environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

/**
 * Everything the eval path needs end to end: the queue/DB, both classifier
 * providers (router falls back groq -> cerebras), the judge, and the cron
 * shared secret.
 */
export const REQUIRED_EVAL_ENV = [
  "CRON_SHARED_SECRET",
  "DATABASE_URL",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
] as const;

/** Throws MissingEnvError listing every absent/blank variable. */
export function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((n) => {
    const v = process.env[n];
    return v === undefined || v.trim() === "";
  });
  if (missing.length > 0) throw new MissingEnvError(missing);
}
