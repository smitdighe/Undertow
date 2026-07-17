// POST /api/register and GET /api/auth/session.
import { z } from "zod";
import { apiFetch } from "./client";

/** 201 body from POST /api/register — the created user, minus the password hash. */
export const registeredUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  // `username String?` in Prisma. The route defaults it to the email local-part,
  // so it is populated in practice, but the column still permits null.
  username: z.string().nullable(),
  role: z.enum(["ONCALL", "VIEWER"]),
  createdAt: z.string(),
});

export type RegisteredUser = z.infer<typeof registeredUserSchema>;

export interface RegisterInput {
  email: string;
  password: string;
  /** Omit to let the backend derive it from the email. Never send "". */
  username?: string;
}

/**
 * POST /api/register. Throws ApiError 409 when the email is taken and 400 with
 * `body.details` (zod fieldErrors) on validation failure.
 */
export async function register(
  input: RegisterInput,
  signal?: AbortSignal
): Promise<RegisteredUser> {
  return apiFetch("/api/register", {
    schema: registeredUserSchema,
    method: "POST",
    body: input,
    signal,
  });
}

/**
 * GET /api/auth/session — NextAuth's own endpoint.
 *
 * Returns {} (not 401) when signed out, so the schema is a union rather than a
 * nullable object. Prefer next-auth/react's useSession in components; this exists
 * for non-React callers.
 */
export const sessionSchema = z.union([
  z.object({
    user: z.object({
      id: z.string(),
      email: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      image: z.string().nullable().optional(),
      role: z.enum(["ONCALL", "VIEWER"]),
    }),
    expires: z.string(),
  }),
  // Signed out: an empty object.
  z.object({}).strict(),
]);

export type SessionResponse = z.infer<typeof sessionSchema>;

export async function getSession(signal?: AbortSignal): Promise<SessionResponse> {
  return apiFetch("/api/auth/session", { schema: sessionSchema, signal });
}
