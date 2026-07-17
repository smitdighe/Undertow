// Sign-in / register surface — composed entry point for the "/auth" route.
import Link from "next/link";
import { AuthTabs } from "./components/AuthTabs";

export function Auth({
  callbackUrl,
  error,
}: {
  callbackUrl: string;
  error?: string | null;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-void px-0 py-10 sm:px-6 sm:py-16">
      {/* Lime bloom behind the card. Gives backdrop-blur something to actually
          diffuse — over flat void the glass treatment is invisible. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime/10 blur-[120px]"
      />

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="mx-auto mb-8 block w-fit rounded-sm text-center font-mono text-mono-sm uppercase text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime"
        >
          Undertow
        </Link>

        {/* The glass card. This treatment is scoped to the auth surface only —
            it is deliberately not part of components/ui/Card. Below sm it goes
            full-bleed: edge-to-edge, square sides, no floating margins. */}
        <div className="rounded-none border-y border-border bg-card/60 p-6 shadow-2xl backdrop-blur-xl sm:rounded-2xl sm:border sm:p-8">
          <h1 className="mb-1 font-display text-heading text-text">Log in to Undertow</h1>
          <p className="mb-7 text-label text-muted">
            Triage the alerts that matter. Ignore the ones that don&apos;t.
          </p>

          <AuthTabs callbackUrl={callbackUrl} initialError={error} />
        </div>
      </div>
    </main>
  );
}

export default Auth;
