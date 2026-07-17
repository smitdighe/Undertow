import { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  // Credentials provider requires JWT session strategy (not database sessions).
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth",
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user) return null;

        // OAuth-created user has no password set — credentials login must fail
        // gracefully rather than passing null into bcrypt.compare.
        if (!user.password) return null;

        const valid = await verifyPassword(credentials.password, user.password);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On sign-in, `user` is present — persist id/role onto the token.
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: Role }).role ?? Role.VIEWER;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? "";
        // token.role may be undefined for pre-existing tokens — default VIEWER.
        session.user.role = (token.role as Role) ?? Role.VIEWER;
      }
      return session;
    },
  },
  events: {
    // PrismaAdapter.createUser only writes name/email/emailVerified/image, so
    // OAuth users land with username = null. Backfill a unique handle here.
    async createUser({ user }) {
      const base = (user.email?.split("@")[0] || user.name || "user")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 30) || "user";
      const username = `${base}-${user.id.slice(0, 6)}`;
      await prisma.user.update({ where: { id: user.id }, data: { username } });
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
