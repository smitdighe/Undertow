import { Session } from "next-auth";
import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

export class RbacError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RbacError";
    this.status = status;
  }
}

/** JSON body shape returned to API clients on an RBAC failure. */
export function forbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function unauthorized(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Throws RbacError if the session is missing (401) or the user lacks `role` (403).
 * Note: ONCALL is treated as a superset of VIEWER — an ONCALL user satisfies a
 * VIEWER requirement, but not vice versa.
 */
export function requireRole(session: Session | null, role: Role): Session {
  if (!session?.user) {
    throw new RbacError("Unauthorized", 401);
  }
  const userRole = session.user.role;
  if (userRole === role) return session;
  if (role === Role.VIEWER && userRole === Role.ONCALL) return session;

  throw new RbacError("Forbidden", 403);
}

export function requireOncall(session: Session | null): Session {
  return requireRole(session, Role.ONCALL);
}
