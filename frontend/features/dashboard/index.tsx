"use client";

// Live incident triage surface — composed entry point for the "/dashboard" route.
import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui";
import { useIncidentStream } from "./hooks/useIncidentStream";
import { useSessionStore, selectIsOncall } from "@/store/sessionStore";
import type { Incident } from "@/types/incident";
import { WaterlineHeader } from "./components/WaterlineHeader";
import { IncidentFeed } from "./components/IncidentFeed";
import { CorrectionModal } from "./components/CorrectionModal";

export function Dashboard() {
  const { retryInitial } = useIncidentStream();

  const hydrate = useSessionStore((s) => s.hydrate);
  const user = useSessionStore((s) => s.user);
  const isOncall = useSessionStore(selectIsOncall);

  const [correcting, setCorrecting] = useState<Incident | null>(null);
  const [signOutError, setSignOutError] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const onSignOut = () => {
    setSignOutError(false);
    // signOut rejects on transport failure; without this catch that's an
    // unhandled rejection and the click silently does nothing.
    signOut({ callbackUrl: "/" }).catch(() => setSignOutError(true));
  };

  return (
    <main className="min-h-screen bg-void px-6 py-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-sm font-mono text-mono-sm uppercase text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime"
          >
            Undertow
          </Link>
          <span className="ml-auto flex items-center gap-3">
            {user && (
              <span className="font-mono text-mono-sm text-muted">
                {user.email ?? user.name ?? user.id} · {user.role}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          </span>
        </div>

        {signOutError && (
          <p role="alert" className="text-label text-alert">
            Sign-out couldn&apos;t reach the server. Try again.
          </p>
        )}

        <section>
          <WaterlineHeader />
          {/* Correction entry points render only for ONCALL — a UI hint. The
              server 403s stale sessions regardless; useCorrection handles that. */}
          <IncidentFeed
            onCorrect={isOncall ? setCorrecting : undefined}
            onRetry={retryInitial}
          />
        </section>
      </div>

      <CorrectionModal incident={correcting} onClose={() => setCorrecting(null)} />
    </main>
  );
}

export default Dashboard;
