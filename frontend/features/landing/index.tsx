// Public marketing/landing surface — composed entry point for the "/" route.
import { Hero } from "./components/Hero";
import { PulseLine } from "./components/PulseLine";

export function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-void">
      {/* Ambient waterline sits behind the hero and spans the full width. It is
          decorative only, so it stays out of the content flow entirely. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55vh] min-h-[320px]">
        <PulseLine />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-24">
        <Hero />
      </div>
    </main>
  );
}

export default Landing;
