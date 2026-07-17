"use client";

// Shared error boundary for every route segment (landing, /auth, /dashboard,
// /admin/metrics) — the nearest boundary Next falls back to when a segment has
// no error.tsx of its own. Renders a real UI on the token palette instead of
// the dev overlay / white screen.
import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The boundary swallows the throw; keep the real error visible to devtools.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-void px-6">
      <div className="flex max-w-md flex-col items-start gap-4">
        <p className="font-mono text-mono-sm uppercase text-muted">Undertow</p>
        <h1 className="font-display text-heading text-text">
          This page hit an error it couldn&apos;t recover from.
        </h1>
        <p className="text-label text-muted">
          Nothing you did caused it. Retry the page; if it keeps failing, the
          error is on our side{error.digest ? ` (ref ${error.digest})` : ""}.
        </p>
        <Button variant="ghost" onClick={reset}>
          Retry
        </Button>
      </div>
    </main>
  );
}
