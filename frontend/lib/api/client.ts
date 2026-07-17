// Typed fetch wrapper for the same-origin /api/* proxy — no data-fetching library by design.
//
// Every response is validated against a zod schema before it is returned, so a
// caller's value is parse-checked at runtime, not just asserted at compile time.
// There are no `any`s and no casts in the success path: the return type is
// z.infer of the schema the caller passed in.
import type { z } from "zod";
import { apiErrorBodySchema, type ApiErrorBody } from "@/types/api";

/** Same-origin by default; the Next rewrite proxies /api/* to the backend. */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** "http://host:1234/" -> "http://host:1234" so `${base}${path}` can't double-slash. */
const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * Absolute origin to use from a server component, route handler or script.
 *
 * A relative URL has no meaning in Node — there is no document to resolve it
 * against — so server-context callers must pass `baseUrl` to apiFetch. Reuses the
 * env vars that already exist rather than inventing one: BACKEND_URL is what
 * next.config.mjs already proxies /api/* to, and NEXT_PUBLIC_APP_URL (this app's
 * own origin, which routes back through that same proxy) is the fallback.
 *
 * Returns null when neither is configured, so the caller can say so rather than
 * silently defaulting to a localhost that doesn't exist in production.
 */
export function serverApiBaseUrl(): string | null {
  const raw = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  return raw ? stripTrailingSlash(raw) : null;
}

// --- Errors ------------------------------------------------------------------
// Three distinct failure modes, deliberately three distinct classes. A caller
// must be able to tell "you may not do this" (403) from "the server is down"
// (network) from "the server said something we don't understand" (schema) —
// collapsing them into one generic error is how a 403 ends up rendering as
// "something went wrong, retry", which retries forever and never succeeds.

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Parsed { error, details?, missing? } when the body was a known error shape. */
    public body: ApiErrorBody | null = null,
    /** Raw text when the body was not JSON (proxy/gateway HTML, empty body). */
    public rawBody: string | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never reached a server, or the connection died. Retryable. */
export class ApiNetworkError extends Error {
  constructor(message = "Can't reach the server.", public cause?: unknown) {
    super(message);
    this.name = "ApiNetworkError";
  }
}

/** 2xx, but the payload did not match the schema. A backend contract break — not retryable. */
export class ApiSchemaError extends Error {
  constructor(
    message: string,
    public issues: z.ZodIssue[],
    public received: unknown
  ) {
    super(message);
    this.name = "ApiSchemaError";
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
export const isUnauthorized = (e: unknown) => isApiError(e) && e.status === 401;
export const isForbidden = (e: unknown) => isApiError(e) && e.status === 403;
export const isNotFound = (e: unknown) => isApiError(e) && e.status === 404;
export const isConflict = (e: unknown) => isApiError(e) && e.status === 409;

// --- Request -----------------------------------------------------------------

export interface ApiRequestOptions<TSchema extends z.ZodTypeAny> {
  /** Validated against this before the value is handed back. */
  schema: TSchema;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON-serialised automatically. */
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /**
   * Absolute origin to prefix the path with, for server-context callers where a
   * relative URL cannot resolve. Use serverApiBaseUrl().
   *
   * Omit it in the browser: the default keeps requests same-origin and relative,
   * which is what lets the session cookie ride along (`credentials: "same-origin"`
   * would withhold cookies from a cross-origin absolute URL).
   */
  baseUrl?: string;
  /**
   * Passed straight to fetch. Mainly for server components, where Next patches
   * fetch and caches by default — "no-store" opts a request out explicitly rather
   * than relying on the route's `dynamic` setting to imply it.
   */
  cache?: RequestCache;
}

export async function apiFetch<TSchema extends z.ZodTypeAny>(
  path: string,
  options: ApiRequestOptions<TSchema>
): Promise<z.infer<TSchema>> {
  const { schema, method = "GET", body, headers = {}, query, signal, baseUrl, cache } = options;

  const url = buildUrl(path, query, baseUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // Send the NextAuth session cookie. The API is same-origin via the rewrite,
      // so "same-origin" is sufficient and avoids opting into cross-site sends.
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Undefined leaves fetch's own default in place, so omitting it changes nothing.
      ...(cache === undefined ? {} : { cache }),
    });
  } catch (cause) {
    // An aborted request is the caller's own doing — surface it as-is rather than
    // reporting a network outage that didn't happen.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    // fetch only rejects on transport failure; any HTTP status resolves.
    throw new ApiNetworkError("Can't reach the server.", cause);
  }

  const text = await response.text();

  if (!response.ok) throw toApiError(response.status, text);

  // 204 and other empty bodies: hand the schema `undefined` so a z.void()/optional
  // schema succeeds and anything else fails loudly rather than silently passing.
  const parsedJson = text.length === 0 ? undefined : safeJsonParse(text);
  if (text.length > 0 && parsedJson === JSON_PARSE_FAILED) {
    throw new ApiSchemaError("Response was not valid JSON.", [], text);
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    throw new ApiSchemaError(
      `Response did not match the expected shape for ${method} ${path}.`,
      result.error.issues,
      parsedJson
    );
  }

  return result.data;
}

// --- Internals ---------------------------------------------------------------

const JSON_PARSE_FAILED = Symbol("json-parse-failed");

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON_PARSE_FAILED;
  }
}

function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  baseUrl?: string
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    // Skip undefined so an omitted filter isn't sent as the string "undefined".
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  // No baseUrl -> the previous behaviour exactly: BASE_URL (usually "") + path.
  const base = baseUrl === undefined ? BASE_URL : stripTrailingSlash(baseUrl);
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/** Build an ApiError, preserving the server's message when it sent a known shape. */
function toApiError(status: number, text: string): ApiError {
  const json = text.length > 0 ? safeJsonParse(text) : undefined;
  if (json !== JSON_PARSE_FAILED && json !== undefined) {
    const parsed = apiErrorBodySchema.safeParse(json);
    if (parsed.success) {
      return new ApiError(status, parsed.data.error, parsed.data, text);
    }
  }
  // Non-JSON error body still carries a usable status.
  return new ApiError(status, `Request failed with status ${status}.`, null, text || null);
}
