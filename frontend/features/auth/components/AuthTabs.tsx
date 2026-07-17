"use client";

// Login/Register toggle plus the GitHub button, which is shared by both tabs —
// "continue with GitHub" means the same thing whether you have an account or not.
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { authErrorMessage } from "../auth-errors";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";

type Tab = "login" | "register";

export function AuthTabs({
  callbackUrl,
  initialError,
}: {
  callbackUrl: string;
  /** ?error= code NextAuth appended after a failed OAuth round-trip. */
  initialError?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("login");
  // Seeded from the query param, then owned locally so switching tabs can clear it.
  const [oauthError, setOauthError] = useState<string | null>(() =>
    authErrorMessage(initialError)
  );

  const selectTab = (next: Tab) => {
    setTab(next);
    // The OAuth error came from a previous page load; it says nothing about the
    // form the user just switched to.
    setOauthError(null);
  };

  const onGitHub = async () => {
    setOauthError(null);
    try {
      // redirect:true here — OAuth is a full-page round-trip by nature. Failures
      // come back as ?error= and are read on the next render, not from a result.
      await signIn("github", { callbackUrl });
    } catch {
      setOauthError("Couldn't reach GitHub. Try again.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Log in or create an account"
        className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-void/40 p-1"
      >
        {(["login", "register"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            aria-controls={`${value}-panel`}
            onClick={() => selectTab(value)}
            className={cn(
              "rounded-md px-4 py-2 text-label transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime",
              tab === value ? "bg-card text-text" : "text-muted hover:text-text"
            )}
          >
            {value === "login" ? "Log in" : "Register"}
          </button>
        ))}
      </div>

      {oauthError && (
        <p role="alert" className="text-label text-alert">
          {oauthError}
        </p>
      )}

      <div id={`${tab}-panel`} role="tabpanel">
        {tab === "login" ? (
          <LoginForm callbackUrl={callbackUrl} />
        ) : (
          <RegisterForm callbackUrl={callbackUrl} />
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono text-mono-sm text-muted">OR</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button variant="ghost" size="lg" className="w-full" onClick={onGitHub}>
        <GitHubGlyph />
        Continue with GitHub
      </Button>
    </div>
  );
}

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="h-4 w-4">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export default AuthTabs;
