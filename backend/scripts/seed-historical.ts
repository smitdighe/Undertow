// Seed synthetic historical incidents with known-correct labels — the eval
// ground truth set. Run: npx tsx scripts/seed-historical.ts [--reset]
//
// Ground truth is expressed the same way production expresses it: a Correction
// row per field, where correctedValue is the true label and originalValue is
// what a classifier had previously (wrongly) produced. eval-runner then re-runs
// the real classify() pipeline and scores it against correctedValue.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { embed } from "@/lib/embeddings";

/** Marker on every seeded row so eval/cleanup can find them. */
export const SEED_SOURCE = "seed";
const SEED_USER_EMAIL = "seed-oncall@undertow.test";

interface SeedSpec {
  key: string;
  title: string;
  body: string;
  /** Ground truth. */
  truth: { severity: string; team: string };
  /** What the "previous classifier" answered — becomes Correction.originalValue. */
  previous: { severity: string; team: string };
  /** key of the incident this one duplicates, if any. */
  duplicateOfKey?: string;
}

const SEEDS: SeedSpec[] = [
  {
    key: "db-pool",
    title: "Database connection pool exhausted on primary Postgres",
    body: "Since 02:14 UTC the primary Postgres reports 'remaining connection slots are reserved'. API p99 latency is above 30s and roughly 60% of requests time out. All customer-facing writes are failing.",
    truth: { severity: "CRITICAL", team: "Platform" },
    previous: { severity: "HIGH", team: "Backend" },
  },
  {
    key: "payment-webhook",
    title: "Stripe payment webhooks failing signature verification",
    body: "All inbound Stripe webhooks have returned 400 since the last deploy. Subscription upgrades are not being recorded and customers are being double charged on retry.",
    truth: { severity: "CRITICAL", team: "Payments" },
    previous: { severity: "HIGH", team: "Payments" },
  },
  {
    key: "login-500",
    title: "Login endpoint returning 500 for all users",
    body: "Every POST to /api/auth/login returns a 500. Nobody can sign in, including staff. Error logs show a null dereference in the session serializer.",
    truth: { severity: "CRITICAL", team: "Identity" },
    previous: { severity: "MEDIUM", team: "Backend" },
  },
  {
    key: "footer-typo",
    title: "Typo in marketing site footer copyright text",
    body: "The footer on the marketing site reads 'Copright 2026' instead of 'Copyright 2026'. Cosmetic only, no functional impact.",
    truth: { severity: "LOW", team: "Frontend" },
    previous: { severity: "MEDIUM", team: "Marketing" },
  },
  {
    key: "dashboard-slow",
    title: "Analytics dashboard queries taking 15+ seconds to load",
    body: "The analytics dashboard takes 15-20 seconds to render for accounts with large datasets. It eventually loads correctly. Users are complaining but the feature works.",
    truth: { severity: "MEDIUM", team: "Platform" },
    previous: { severity: "HIGH", team: "Data" },
  },
  {
    key: "email-delay",
    title: "Transactional emails delayed by up to 40 minutes",
    body: "Password reset and receipt emails are queuing behind a backlog in the notification worker. Emails do arrive, but 30-40 minutes late. Password resets are effectively unusable.",
    truth: { severity: "HIGH", team: "Notifications" },
    previous: { severity: "MEDIUM", team: "Platform" },
  },
  {
    key: "mobile-crash",
    title: "iOS app crashes immediately on launch after 4.2.0 release",
    body: "Version 4.2.0 crashes on launch for all iOS 17 users. Crashlytics shows a nil unwrap in the onboarding coordinator. App is unusable for affected users; the App Store rollout is still live.",
    truth: { severity: "CRITICAL", team: "Mobile" },
    previous: { severity: "HIGH", team: "Mobile" },
  },
  {
    key: "search-stale",
    title: "Search results showing stale data up to 2 hours old",
    body: "The search index lags behind the primary DB by up to 2 hours. Newly created records are not findable until the lag clears. Search itself is responsive and returns results.",
    truth: { severity: "MEDIUM", team: "Search" },
    previous: { severity: "LOW", team: "Search" },
  },
  {
    key: "logo-blurry",
    title: "Header logo renders blurry on retina displays",
    body: "Since the last deploy the header logo is a 1x raster instead of the SVG. It looks soft on high-DPI screens. Purely visual.",
    truth: { severity: "LOW", team: "Frontend" },
    previous: { severity: "MEDIUM", team: "Design" },
  },
  {
    key: "ratelimit-block",
    title: "Rate limiter blocking legitimate enterprise customers",
    body: "The new rate limiter is counting per-org requests against a per-user budget. Three enterprise accounts are getting 429s on normal traffic and cannot use the API.",
    truth: { severity: "HIGH", team: "Platform" },
    previous: { severity: "MEDIUM", team: "Platform" },
  },
  {
    key: "csv-export",
    title: "CSV export times out for accounts with over 100k rows",
    body: "The CSV export endpoint hits the 60s gateway timeout for large accounts. Smaller exports work fine. Affected users have a workaround via the API.",
    truth: { severity: "MEDIUM", team: "Data" },
    previous: { severity: "HIGH", team: "Backend" },
  },
  {
    key: "ssl-expiry",
    title: "TLS certificate for api.example.com expires in 48 hours",
    body: "Monitoring flagged that the TLS cert for the primary API domain expires in 48 hours and auto-renewal has failed twice. If it lapses, every client will fail TLS handshake.",
    truth: { severity: "HIGH", team: "Platform" },
    previous: { severity: "LOW", team: "Security" },
  },
  {
    key: "disk-full",
    title: "Log volume at 94% capacity on production hosts",
    body: "Log partitions on the three production app hosts are at 94% and climbing about 1% per hour. Nothing is broken yet, but writes will fail when it hits 100%.",
    truth: { severity: "MEDIUM", team: "Platform" },
    previous: { severity: "CRITICAL", team: "Platform" },
  },
  {
    key: "onboarding-copy",
    title: "Onboarding tooltip references a renamed feature",
    body: "The onboarding tooltip still says 'Workspaces' but the feature was renamed to 'Projects' two releases ago. Confusing but harmless.",
    truth: { severity: "LOW", team: "Frontend" },
    previous: { severity: "MEDIUM", team: "Frontend" },
  },
  // --- duplicate pairs: the second of each pair duplicates the first ---
  {
    key: "checkout-a",
    title: "Checkout API returning 500 errors at high rate",
    body: "Starting 14:20 UTC roughly 40% of POST /checkout requests return 500. Logs show the payments service database connection pool is exhausted. Customers cannot complete purchases.",
    truth: { severity: "CRITICAL", team: "Payments" },
    previous: { severity: "HIGH", team: "Payments" },
  },
  {
    key: "checkout-b",
    title: "Customers report checkout failing with 500 errors",
    body: "Since about 14:20 UTC many checkout POST requests are returning 500 responses. The payments service DB connection pool appears exhausted. Purchases cannot be completed.",
    truth: { severity: "CRITICAL", team: "Payments" },
    previous: { severity: "HIGH", team: "Payments" },
    duplicateOfKey: "checkout-a",
  },
  {
    key: "redis-a",
    title: "Redis cache cluster unreachable from all app nodes",
    body: "All application nodes report connection timeouts to the Redis cache cluster starting 09:10 UTC. Session lookups and rate limiting are degraded and falling back to the database.",
    truth: { severity: "HIGH", team: "Platform" },
    previous: { severity: "CRITICAL", team: "Platform" },
  },
  {
    key: "redis-b",
    title: "Cannot connect to Redis cluster from application servers",
    body: "Every app server is timing out when connecting to the Redis cache cluster since around 09:10 UTC. Rate limiting and session storage have degraded to database fallback.",
    truth: { severity: "HIGH", team: "Platform" },
    previous: { severity: "CRITICAL", team: "Platform" },
    duplicateOfKey: "redis-a",
  },
];

async function main() {
  const reset = process.argv.includes("--reset");

  if (reset) {
    const seeded = await prisma.incident.findMany({
      where: { source: SEED_SOURCE },
      select: { id: true },
    });
    const ids = seeded.map((s) => s.id);
    await prisma.correction.deleteMany({ where: { incidentId: { in: ids } } });
    // Clear self-references before delete so the FK doesn't block us.
    await prisma.incident.updateMany({
      where: { id: { in: ids } },
      data: { duplicateOfId: null },
    });
    await prisma.incident.deleteMany({ where: { source: SEED_SOURCE } });
    console.log(`reset: removed ${ids.length} seeded incidents`);
  }

  // Corrections need a real user (FK).
  const user = await prisma.user.upsert({
    where: { email: SEED_USER_EMAIL },
    update: { role: "ONCALL" },
    create: { email: SEED_USER_EMAIL, username: "seed_oncall", role: "ONCALL" },
  });

  const idByKey = new Map<string, string>();

  // Pass 1: incidents (embeddings included so the dedupe path can be evaluated).
  for (const spec of SEEDS) {
    const externalId = `seed-${spec.key}`;
    const existing = await prisma.incident.findUnique({
      where: { externalId },
      select: { id: true },
    });
    if (existing) {
      idByKey.set(spec.key, existing.id);
      continue;
    }

    const embedding = await embed(`${spec.title}\n\n${spec.body}`);
    const incident = await prisma.incident.create({
      data: {
        source: SEED_SOURCE,
        externalId,
        title: spec.title,
        body: spec.body,
        // The *previous* (wrong) classifier output is what's on the row; the
        // Correction rows below carry the ground truth.
        severity: spec.previous.severity as never,
        suggestedTeam: spec.previous.team,
        status: spec.duplicateOfKey ? "DUPLICATE" : "OPEN",
        embedding,
      },
      select: { id: true },
    });
    idByKey.set(spec.key, incident.id);
  }

  // Pass 2: duplicate links + corrections (needs all ids resolved).
  let corrections = 0;
  for (const spec of SEEDS) {
    const incidentId = idByKey.get(spec.key)!;

    if (spec.duplicateOfKey) {
      const targetId = idByKey.get(spec.duplicateOfKey)!;
      await prisma.incident.update({
        where: { id: incidentId },
        data: { duplicateOfId: targetId },
      });
    }

    const existing = await prisma.correction.findMany({
      where: { incidentId },
      select: { field: true },
    });
    const have = new Set(existing.map((c) => c.field));

    const rows: { field: string; originalValue: string; correctedValue: string }[] = [];
    if (!have.has("severity")) {
      rows.push({
        field: "severity",
        originalValue: spec.previous.severity,
        correctedValue: spec.truth.severity,
      });
    }
    if (!have.has("team")) {
      rows.push({
        field: "team",
        originalValue: spec.previous.team,
        correctedValue: spec.truth.team,
      });
    }
    if (spec.duplicateOfKey && !have.has("duplicate")) {
      rows.push({
        field: "duplicate",
        originalValue: "",
        correctedValue: idByKey.get(spec.duplicateOfKey)!,
      });
    }

    for (const r of rows) {
      await prisma.correction.create({
        data: { incidentId, userId: user.id, ...r },
      });
      corrections++;
    }
  }

  console.log(
    JSON.stringify({
      seededIncidents: idByKey.size,
      correctionsCreated: corrections,
      marker: `source="${SEED_SOURCE}"`,
    })
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("seed failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
