// Post-login redirect target resolution. Shared by middleware.ts (server-side
// redirect) and the auth forms (client-side push) so both agree on what is safe.

export const DEFAULT_AFTER_LOGIN = "/dashboard";

/** The sign-in page itself. Redirecting here after login is the loop case. */
const AUTH_PATH = "/auth";

/**
 * Reduce an untrusted `callbackUrl` to a safe same-origin path.
 *
 * Rejects, falling back to DEFAULT_AFTER_LOGIN:
 *  - absolute/protocol URLs ("https://evil.com") — an open redirect, since the
 *    value arrives straight from a query string an attacker can hand a victim;
 *  - protocol-relative ("//evil.com") and backslash ("/\evil.com") forms, which
 *    browsers also resolve off-origin;
 *  - /auth itself — middleware bounces an authenticated visitor off /auth, so
 *    sending them back to /auth would redirect forever.
 */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_LOGIN;
  if (!raw.startsWith("/")) return DEFAULT_AFTER_LOGIN;
  // "//host" and "/\host" are both off-origin once the browser resolves them.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_AFTER_LOGIN;

  const path = raw.split(/[?#]/)[0];
  if (path === AUTH_PATH || path.startsWith(`${AUTH_PATH}/`)) {
    return DEFAULT_AFTER_LOGIN;
  }

  return raw;
}
