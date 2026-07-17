"use client";

// Landing hero: headline, tagline, single CTA. Public — no session check.
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui";
import { getRiseVariant } from "@/components/motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export function Hero() {
  const reduced = useReducedMotion();
  const rise = getRiseVariant(reduced);

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      // Children inherit the parent's animate state; the stagger is what makes the
      // headline settle before the CTA arrives.
      transition={{ staggerChildren: reduced ? 0 : 0.09 }}
      className="flex flex-col items-center text-center"
    >
      <motion.p
        variants={rise}
        className="mb-6 font-mono text-mono-sm uppercase text-muted"
      >
        Undertow — AI incident triage
      </motion.p>

      <motion.h1
        variants={rise}
        className="max-w-4xl font-display text-display-lg text-text md:text-display-xl"
      >
        Pulls the real signal out of a flood of alerts
        {/* The break lands the emotional half of the tagline on its own line. */}
        <span className="block text-muted">before it wakes anyone up.</span>
      </motion.h1>

      <motion.p
        variants={rise}
        className="mt-7 max-w-xl text-body text-muted"
      >
        Every alert surfaces. Most settle on their own. Undertow decides which ones
        are worth your night.
      </motion.p>

      <motion.div variants={rise} className="mt-10">
        <Button asChild variant="primary" size="lg">
          <Link href="/auth">Start triaging</Link>
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default Hero;
