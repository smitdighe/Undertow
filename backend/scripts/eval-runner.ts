// Eval harness CLI. The logic lives in lib/eval/runner.ts so the cron route
// (app/api/cron/eval/route.ts) can invoke exactly the same code path.
//
//   npx tsx scripts/eval-runner.ts [--limit N] [--seed-only]
//                                  [--min-sample N] [--fail-on-drift]
//
// Exit codes (used by .github/workflows/eval-gate.yml):
//   0 = eval ran, no drift (or drift but --fail-on-drift not set)
//   1 = driftFlag true and --fail-on-drift set  -> block the merge
//   2 = sample too small to trust driftFlag     -> fail loudly, never a silent pass
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { MIN_TRUSTWORTHY_SAMPLE, runEval } from "@/lib/eval/runner";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const limitArg = arg("--limit");
  const minSample = Number(arg("--min-sample") ?? MIN_TRUSTWORTHY_SAMPLE);
  const failOnDrift = process.argv.includes("--fail-on-drift");

  const result = await runEval({
    limit: limitArg ? Number(limitArg) : undefined,
    seedOnly: process.argv.includes("--seed-only"),
    minTrustworthySample: minSample,
  });

  const r3 = (n: number) => Number(n.toFixed(3));
  const fmt = (m: { precision: number; recall: number; f1: number; support: number; accuracy: number }) => ({
    precision: r3(m.precision),
    recall: r3(m.recall),
    f1: r3(m.f1),
    support: m.support,
    accuracy: r3(m.accuracy),
  });

  console.log(
    JSON.stringify(
      {
        event: "eval.complete",
        evalRunId: result.evalRunId,
        written: result.written,
        sampleSize: result.sampleSize,
        effectiveSampleSize: result.effectiveSampleSize,
        lowSample: result.lowSample,
        fields: {
          severity: fmt(result.fields.severity),
          team: fmt(result.fields.team),
          duplicate: fmt(result.fields.duplicate),
        },
        aggregate: {
          precision: r3(result.aggregate.precision),
          recall: r3(result.aggregate.recall),
          f1: r3(result.aggregate.f1),
        },
        judge: result.judge,
        classifyFailures: result.classifyFailures,
        drift: {
          driftFlag: result.drift.driftFlag,
          rollingAvg: result.drift.rollingAvg === null ? null : r3(result.drift.rollingAvg),
          relativeDrop:
            result.drift.relativeDrop === null ? null : r3(result.drift.relativeDrop),
          historyRuns: result.drift.historyRuns,
        },
      },
      null,
      2
    )
  );

  // --- CI gate semantics ---

  // An empty/tiny ground-truth set makes driftFlag meaningless. Exiting 0 here
  // would let a regression sail through a green check, so fail loudly instead.
  if (result.sampleBelowTrustThreshold) {
    console.error(
      `::error::Eval sample too small to trust: pulled=${result.sampleSize}, ` +
        `scored=${result.effectiveSampleSize} (classify failures: ${result.classifyFailures}), ` +
        `minimum=${minSample}. Either the eval database lacks seeded ground truth ` +
        `(run: npx tsx scripts/seed-historical.ts) or the LLM providers were ` +
        `unavailable/rate-limited during the run.`
    );
    process.exitCode = 2;
    return;
  }

  if (result.drift.driftFlag) {
    const msg =
      `Eval drift detected: F1 ${result.aggregate.f1.toFixed(3)} vs rolling avg ` +
      `${result.drift.rollingAvg?.toFixed(3)} over ${result.drift.historyRuns} runs ` +
      `(relative drop ${(100 * (result.drift.relativeDrop ?? 0)).toFixed(1)}%).`;
    if (failOnDrift) {
      console.error(`::error::${msg} Blocking merge.`);
      process.exitCode = 1;
    } else {
      console.warn(`::warning::${msg}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("eval failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
