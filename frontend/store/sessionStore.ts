"use client";

// Session snapshot for UI gating. Hydrated once from GET /api/auth/session on
// dashboard mount — no SessionProvider needed since nothing here mutates auth.
//
// This is a UI HINT only. Hiding the correction button for a VIEWER is courtesy;
// the real gate is the backend's 403, which useCorrection handles regardless.
import { create } from "zustand";
import { getSession, type SessionResponse } from "@/lib/api/auth";

/** The authenticated member of the session union (signed out is `{}`). */
type AuthedSession = Extract<SessionResponse, { user: unknown }>;
export type SessionUser = AuthedSession["user"];

interface SessionStoreState {
  status: "loading" | "authenticated" | "unauthenticated";
  user: SessionUser | null;
  hydrate: () => Promise<void>;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  status: "loading",
  user: null,

  hydrate: async () => {
    try {
      const session = await getSession();
      if ("user" in session) {
        set({ status: "authenticated", user: session.user });
      } else {
        set({ status: "unauthenticated", user: null });
      }
    } catch (error) {
      // Can't confirm a session — fail closed to viewer-level UI. The server
      // would still 403 any write, so this only affects what's shown.
      console.warn("[session] hydrate failed", error);
      set({ status: "unauthenticated", user: null });
    }
  },
}));

export const selectIsOncall = (s: { user: SessionUser | null }) =>
  s.user?.role === "ONCALL";
