// Mirrors backend/types/next-auth.d.ts. The role union is spelled out literally
// rather than imported from @prisma/client: the frontend has no Prisma dependency,
// and adding one just for an enum would pull the whole client into this bundle.
// If backend's Role enum gains a member, this must be updated to match.
import { DefaultSession } from "next-auth";

export type Role = "ONCALL" | "VIEWER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
  }
}
