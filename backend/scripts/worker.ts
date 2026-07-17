// Undertow job worker. Run with: npm run worker  (or: npx tsx scripts/worker.ts)
// --drain: process until the queue is empty, then exit (useful for cron/tests).
import "dotenv/config";
import { runWorker } from "@/lib/jobs/worker";
import { processJob } from "@/lib/jobs/process";
import { prisma } from "@/lib/prisma";
import { assertRequiredEnv, MissingEnvError, REQUIRED_EVAL_ENV } from "@/lib/env";

const drain = process.argv.includes("--drain");

// Fail fast before claiming any work: a missing key would otherwise surface
// mid-job, burning an attempt and leaving the job to retry until FAILED.
try {
  assertRequiredEnv(REQUIRED_EVAL_ENV);
} catch (err) {
  if (err instanceof MissingEnvError) {
    console.error(`worker cannot start: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

runWorker({
  pollMs: 1500,
  idleExitPolls: drain ? 3 : Infinity,
  processJob,
})
  .catch((err) => {
    console.error("worker crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
