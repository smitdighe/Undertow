<div align="center">

 <pre>
```
██╗   ██╗███╗   ██╗██████╗ ███████╗██████╗ ████████╗ ██████╗ ██╗    ██╗
██║   ██║████╗  ██║██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔═══██╗██║    ██║
██║   ██║██╔██╗ ██║██║  ██║█████╗  ██████╔╝   ██║   ██║   ██║██║ █╗ ██║
██║   ██║██║╚██╗██║██║  ██║██╔══╝  ██╔══██╗   ██║   ██║   ██║██║███╗██║
╚██████╔╝██║ ╚████║██████╔╝███████╗██║  ██║   ██║   ╚██████╔╝╚███╔███╔╝
 ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═╝   ╚═╝    ╚═════╝  ╚══╝╚══╝ 
```
</pre>

*Pulls the real signal out of a flood of alerts before it wakes anyone up.*

🌐 Live Demo: not yet deployed

</div>

<div align="center">

Undertow is an AI incident triage system. A GitHub webhook fires, the incident is
deduplicated against open incidents with local embeddings, classified by an LLM with a
provider fallback chain, and streamed live to a dashboard over SSE — where a human on-call
engineer approves, edits, or rejects the machine's call. Every correction is logged as
ground truth, and a nightly LLM-judged eval scores the classifier against those corrections
and blocks CI on F1 drift.

**It is human-in-the-loop by design, not autonomous end to end.** The classifier proposes a
severity, an owning team, and a draft response; a human decides. The corrections are the
product, not a side effect — they are the ground truth the eval measures against.

</div>

## 🔍 How It Works

```
  GitHub issue event
         │
         ▼
  POST /api/webhook
         │
         ├─ HMAC-SHA256 verify (x-hub-signature-256, raw bytes) ──► 401 on mismatch
         │
         ├─ normalize ─► non-issue / ping events ──► 200 { ignored }
         │
         ├─ externalId unique check ──► redelivery ──► 200 { duplicateDelivery }
         │
         ▼
  embed(title + body)                    all-MiniLM-L6-v2, 384-dim, local, zero API cost
         │
         ▼
  findDuplicate(cosine ≥ 0.87) ──► HIT ──► Incident{status:DUPLICATE, duplicateOfId}
         │                                        │         (no LLM call, no job)
         │ MISS                                   └──► SSE broadcast
         ▼
  ┌─ transaction ─────────────────────────┐
  │  Incident{status:OPEN, severity:LOW*} │      *placeholder until classified
  │  Job{type:CLASSIFY, status:PENDING}   │
  └───────────────────────────────────────┘
         │
         ├──► SSE broadcast (feed shows it pending)
         ▼
  worker  ─ claimNext(): UPDATE ... WHERE id = (
              SELECT id ... ORDER BY createdAt
              LIMIT 1 FOR UPDATE SKIP LOCKED )   ◄── atomic claim, no double-processing
         │
         ▼
  classify()
         │
         ├─ Groq  llama-3.3-70b-versatile ──► ok ──┐
         │        │ any failure (429 / timeout /   │
         │        │ malformed JSON / other)        │
         │        ▼                                │
         └─ Cerebras  gpt-oss-120b ──────► ok ─────┤
                  │ both fail                      │
                  ▼                                │
            AllProvidersFailedError                │
            └─► fail(job): attempts+1, 30s backoff │
                └─► attempts ≥ 3 ──► FAILED (manual review)
                                                   │
         ┌─────────────────────────────────────────┘
         ▼
  zod-validated { severity, suggestedTeam, draftResponse }
         │
         ▼
  Incident updated ──► pg_notify('incident_events', id)
                              │
                              ▼
                       LISTEN (web process) ─► re-fetch row ─► broadcast
                              │
                              ▼
                    GET /api/incidents/stream  (event: incident)
                              │
                              ▼
                        dashboard feed
                              │
                              ▼
              human approve / edit / reject   ◄── ONCALL only
                              │
                              ▼
              POST /api/incidents/[id]/correct
                              │
                    ┌─ transaction ──────────────┐
                    │  Correction{field, from,to}│  ◄── ground truth
                    │  Incident updated          │
                    └────────────────────────────┘
                              │
                              ▼  (nightly, 03:00 UTC — GitHub Actions cron)
              POST /api/cron/eval  (x-cron-secret) ──► 202 { jobId }
                              │
                              ▼
              Job{type:EVAL} ──► worker ──► runEval()
                              │
                              ├─ re-run classify() over incidents WITH corrections
                              ├─ strict compare vs latest correction per field
                              └─ disagreement ──► Gemini 2.0 Flash judge
                                                  { reasonable, rationale }
                              │
                              ▼
              EvalRun{precision, recall, f1, sampleSize, driftFlag}
                              │
                              ▼
              drift = (rollingAvg − f1) / rollingAvg > 0.05
                      rollingAvg = last 5 runs, sampleSize ≥ 10 only
                              │
                              ▼
              Eval Gate (PRs touching backend/lib/llm/**)
              exit 1 on drift ──► merge blocked
```

What makes this a system rather than a demo is where the guarantees sit. Every LLM response
crosses a zod schema before it touches the database, so a malformed generation is a caught
error and a provider fallback, never a corrupt row. Job claiming is a single
`FOR UPDATE SKIP LOCKED` statement rather than a read-then-write, so two concurrent workers
can never process the same incident — and a job orphaned by a dead worker becomes reclaimable
after 5 minutes instead of being lost. Retries are hard-capped at 3 attempts with a 30-second
backoff, so a permanently failing job parks in `FAILED` for manual review instead of burning
API budget in a hot loop.

## ✨ Features

<table>
<tr>
<td width="33%" valign="top">

### 🔀 Provider fallback
Groq (`llama-3.3-70b-versatile`) is the primary classifier. **Any** failure — 429, timeout,
malformed JSON — falls through to Cerebras (`gpt-oss-120b`) with the identical prompt. Both
failing raises `AllProvidersFailedError` and flags the incident for manual review.

</td>
<td width="33%" valign="top">

### 🧬 Zero-cost dedupe
`all-MiniLM-L6-v2` runs locally via transformers.js — no API call, no per-incident cost. A
cosine similarity ≥ `0.87` against open incidents marks the incident `DUPLICATE` and **skips
the LLM entirely**. Dedupe is the cheapest possible path.

</td>
<td width="33%" valign="top">

### 📡 Live SSE feed
`pg_notify` bridges the worker and web processes, so a classification completing in the
worker reaches the browser without polling. Heartbeat every 25s; listeners unsubscribe on
client abort so dead connections never accumulate.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### ✍️ Correction logging
Every human override writes a `Correction` row — field, original value, corrected value,
author — in the same transaction as the incident update. This is the ground-truth corpus the
eval scores against.

</td>
<td width="33%" valign="top">

### ⚖️ LLM-judged eval + CI gate
A nightly job re-runs the live classifier against corrected incidents. Strict mismatches
escalate to a Gemini 2.0 Flash judge. A relative F1 drop > 5% vs the rolling 5-run average
sets `driftFlag` and **blocks the merge**.

</td>
<td width="33%" valign="top">

### 🔐 Role-gated actions
NextAuth (GitHub OAuth + credentials, JWT sessions) with `ONCALL` / `VIEWER`. The dashboard
hides correction controls from viewers as a hint; the server independently 403s them. The UI
is never the security boundary.

</td>
</tr>
</table>

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Landing, auth, dashboard, eval metrics |
| Backend | Next.js 14 (App Router), separate app on `:3001` | Route handlers, SSE, webhook |
| Auth | NextAuth v4 — GitHub OAuth + Credentials, JWT strategy | Sign-in, session, `ONCALL`/`VIEWER` roles |
| Database | Neon Postgres + Prisma 7 (`@prisma/adapter-pg`) | Incidents, corrections, users, eval runs |
| Job queue | The same Postgres — `Job` table, `FOR UPDATE SKIP LOCKED` | Async classify + eval. **No Redis, no BullMQ** |
| Live updates | Server-Sent Events + Postgres `LISTEN`/`NOTIFY` | Cross-process push to the dashboard |
| Classifier | Groq `llama-3.3-70b-versatile` (groq-sdk) | Primary severity/team/draft classification |
| Fallback | Cerebras `gpt-oss-120b` (raw fetch, OpenAI-compatible) | Retry once on any Groq failure |
| Judge | Gemini 2.0 Flash (`@google/generative-ai`) | Eval adjudication + long-form drafts |
| Embeddings | transformers.js `Xenova/all-MiniLM-L6-v2` (384-dim) | Local dedupe, no API cost |
| Validation | zod 4 | LLM output + API request/response boundaries |
| State | Zustand | Incident store (80ms SSE ingest buffer), session store |
| UI | Tailwind CSS 3, Framer Motion 12, Recharts 3 | Design tokens, motion, drift charts |
| CI | GitHub Actions | Eval gate on PRs, nightly eval cron |
| Hosting | *Not configured yet — see Known Limitations* | — |

**Stack notes, verified against `package.json`:**
- **Cerebras is not Llama 3.1 70B.** A code comment in `backend/lib/llm/cerebras.ts` records
  that Llama 70B is no longer served on this account; the model is `gpt-oss-120b`. There is
  also **no Cerebras SDK dependency** — the client is a raw `fetch` against their
  OpenAI-compatible endpoint.
- **No hosting provider is installed or configured.** No `vercel.json`, no `render.yaml`, no
  deploy config of any kind exists in the repo. Vercel/Render are a *plan*, not a fact.
- `GEMINI_MODEL` overrides the judge model when `gemini-2.0-flash` has no quota on an account.

## 📁 Project Structure

```
Undertow/
├── .github/workflows/
│   ├── eval-gate.yml           # Blocks PRs touching backend/lib/llm/** on F1 drift
│   └── nightly-eval.yml        # 03:00 UTC cron -> POST /api/cron/eval -> poll -> report
│
├── frontend/                   # Next.js app, :3000 — proxies /api/* to the backend
│   ├── app/
│   │   ├── admin/metrics/      # Eval + drift dashboard
│   │   ├── auth/               # Sign-in / register
│   │   ├── dashboard/          # Live incident feed
│   │   ├── error.tsx           # Shared route error boundary
│   │   ├── fonts/
│   │   ├── layout.tsx
│   │   └── page.tsx            # Landing
│   ├── components/
│   │   ├── motion/             # Shared Framer variants (+ reduced-motion twins)
│   │   └── ui/                 # Badge, Button, Card, Input, Modal
│   ├── features/
│   │   ├── auth/               # AuthTabs, LoginForm, RegisterForm, useAuthForm
│   │   ├── dashboard/          # IncidentFeed/Card, CorrectionModal, WaterlineHeader,
│   │   │                       #   SeverityBadge, DuplicateSinkIndicator, ConnectionStatus,
│   │   │                       #   useIncidentStream, useCorrection
│   │   ├── eval-metrics/       # DriftChart, EvalRunTable, ThresholdBreachBanner,
│   │   │                       #   drift.ts (mirrors backend drift rule), useEvalHistory
│   │   └── landing/            # Hero, PulseLine
│   ├── hooks/useReducedMotion.ts
│   ├── lib/
│   │   ├── api/                # Typed fetch client, zod schemas, incidents, evalRuns, poll
│   │   ├── sse/                # createIncidentStream (state machine + polling fallback)
│   │   └── utils/              # cn, callback-url
│   ├── store/                  # incidentStore (SSE buffer), sessionStore, ui
│   ├── styles/tokens.css       # Single source of truth for colour
│   ├── types/                  # incident, evalRun, job, api, next-auth
│   ├── middleware.ts           # Route gating via getToken
│   ├── next.config.mjs         # /api/* rewrite -> BACKEND_URL (keeps cookies same-origin)
│   └── tailwind.config.ts
│
└── backend/                    # Next.js app, :3001 + the worker process
    ├── app/api/
    │   ├── auth/[...nextauth]/ # NextAuth handler
    │   ├── cron/eval/          # POST enqueue (202) + GET [jobId] status
    │   ├── incidents/          # GET list, [id]/correct, stream (SSE)
    │   ├── register/           # POST create account
    │   └── webhook/            # POST GitHub ingestion
    ├── lib/
    │   ├── auth/               # rbac (requireOncall), password (bcrypt)
    │   ├── eval/               # runner (drift rule), metrics
    │   ├── jobs/               # queue (SKIP LOCKED claim), worker, process, types
    │   ├── llm/                # router, groq, cerebras, gemini, parse, prompts/
    │   ├── sse/                # bus (LISTEN/NOTIFY), broadcaster
    │   ├── webhook/            # verify (HMAC), normalize
    │   ├── dedupe.ts           # cosine similarity, 0.87 threshold
    │   ├── embeddings.ts       # all-MiniLM-L6-v2 singleton
    │   └── env.ts              # Fail-fast env validation
    ├── prisma/
    │   ├── migrations/         # 4 migrations
    │   └── schema.prisma       # User, Incident, Correction, Job, EvalRun, Account, Session
    └── scripts/
        ├── worker.ts           # Long-running job processor (--drain for one pass)
        ├── eval-runner.ts      # CLI eval (--fail-on-drift --min-sample)
        └── seed-historical.ts  # Seed incidents + corrections
```

There is **no root `package.json`** — `frontend/` and `backend/` are independent npm projects
with their own lockfiles, installed and run separately.

## ⚙️ Getting Started

### Prerequisites

- **Node.js** — no `engines` field is set in either `package.json`. CI runs **Node 22**
  (`.github/workflows/eval-gate.yml`), which is the only version this project is verified
  against.
- **A Postgres database** — the project targets [Neon](https://neon.tech) (serverless Postgres).
- **API keys** — [Groq](https://console.groq.com), [Cerebras](https://cloud.cerebras.ai),
  [Google AI Studio](https://aistudio.google.com) (Gemini).
- **A GitHub OAuth App** — for the OAuth sign-in path.
- **A GitHub webhook secret** — for incident ingestion.

### 1. Clone

```bash
git clone <repo-url>
cd Undertow
```

### 2. Backend

```bash
cd backend
npm install
```

Create `backend/.env` from `backend/.env.example`:

```bash
DATABASE_URL=            # Neon Postgres connection string
GROQ_API_KEY=
CEREBRAS_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=            # optional; overrides gemini-2.0-flash when it has no quota
GITHUB_WEBHOOK_SECRET=
CRON_SHARED_SECRET=
NEXTAUTH_URL=            # the PUBLIC frontend origin — the browser reaches the API
                         # through the frontend's /api/* proxy rewrite
NEXTAUTH_SECRET=         # must match frontend/.env exactly
GITHUB_ID=
GITHUB_SECRET=
```

Apply migrations and generate the client:

```bash
npx prisma migrate deploy
npx prisma generate
npm run seed:historical   # optional — seeds incidents + corrections
```

### 3. Frontend

```bash
cd ../frontend
npm install
```

Create `frontend/.env` from `frontend/.env.example`:

```bash
BACKEND_URL=                          # e.g. http://localhost:3001 — rewrite target
NEXTAUTH_SECRET=                      # byte-identical to backend/.env
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_API_BASE_URL=             # same-origin by default; only if API is split
NEXT_PUBLIC_ENABLE_SSE_RECONNECT=true
NEXT_PUBLIC_SSE_RECONNECT_MS=3000
NEXT_PUBLIC_POLL_FALLBACK_MS=         # polling interval when SSE drops
NEXT_PUBLIC_REDUCED_MOTION_DEFAULT=false
```

`NEXTAUTH_SECRET` must be byte-identical across both files: the backend issues the session
JWT, and the frontend's `middleware.ts` decrypts it with `getToken()`.

### 4. Run

No root script runs these together — there is no root `package.json`. Use **three terminal
panes**:

```bash
# Pane 1 — backend API
cd backend && npm run dev        # :3001

# Pane 2 — worker (nothing gets classified without this)
cd backend && npm run worker

# Pane 3 — frontend
cd frontend && npm run dev       # :3000
```

Open <http://localhost:3000>. The frontend proxies `/api/*` to `BACKEND_URL`, so everything
is same-origin from the browser's point of view — which is what lets the NextAuth session
cookie work across the split.

The worker is a **separate process**, not part of either Next app. Without it, incidents are
ingested and appear in the feed but stay unclassified (`severity: LOW`, `suggestedTeam: null`).

### 5. Grant yourself ONCALL

New accounts default to `VIEWER`, which cannot submit corrections. There is no self-serve
promotion — update the row directly:

```sql
UPDATE "User" SET role = 'ONCALL' WHERE email = 'you@example.com';
```

## 🔌 API

All routes live on the backend (`:3001`) and are reached through the frontend's `/api/*`
rewrite in normal use.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/webhook` | HMAC-SHA256 (`x-hub-signature-256`) | GitHub issue ingestion → dedupe → enqueue |
| `GET` | `/api/incidents` | **None** | List incidents. `status`, `severity`, `limit` (1–100, default 20), `offset` |
| `GET` | `/api/incidents/stream` | **None** | SSE live feed |
| `POST` | `/api/incidents/[id]/correct` | Session + **ONCALL** | Log a correction and update the incident |
| `POST` | `/api/register` | None | Create a credentials account (defaults to `VIEWER`) |
| `GET`/`POST` | `/api/auth/[...nextauth]` | — | NextAuth (GitHub OAuth + credentials) |
| `POST` | `/api/cron/eval` | `x-cron-secret` | Enqueue an EVAL job → `202 { jobId }` |
| `GET` | `/api/cron/eval/[jobId]` | `x-cron-secret` | Poll eval job status + resulting `EvalRun` |

`POST /api/incidents/[id]/correct` accepts `{ field: "severity" | "team" | "duplicate",
correctedValue: string }` and returns `400` on an invalid severity or a self-referential
duplicate, `403` for a `VIEWER`, `404` for an unknown incident.

### SSE event shape

`GET /api/incidents/stream` opens with `retry: 3000` and a `: connected` comment, then sends
a `: ping` comment every 25s. Incident events carry the full row **minus `embedding`**:

```
event: incident
data: {"id":"clx…","source":"github","externalId":"I_kw…","title":"…","body":"…",
       "severity":"HIGH","status":"OPEN","suggestedTeam":"Platform",
       "draftResponse":"…","duplicateOfId":null,"createdAt":"2026-07-17T09:49:00.000Z"}
```

`severity` is non-nullable in the schema, so a not-yet-classified incident arrives as
`severity: "LOW"` with `suggestedTeam: null` — the null team, not the severity, is the honest
signal that classification is still pending.

## ⚠️ Known Limitations

- **No `GET /api/eval-runs` history route.** It does not exist. `/admin/metrics` therefore runs
  in degraded single-point mode: it renders one run resolved from `?jobId=`, draws no gate line
  (a rolling average needs prior runs), and says so inline rather than showing an empty chart.
- **No route to discover the most recent job id.** `?jobId=` must be supplied by hand from a
  completed eval job. Nothing enumerates them.
- **No self-serve ONCALL promotion.** Every account defaults to `VIEWER`; the only way to grant
  `ONCALL` is a manual `UPDATE` against the database.
- **`CRON_SHARED_SECRET` is backend-only by design.** The frontend's `?jobId=` fallback reads it
  server-side only if present, and prints an explicit note when it is absent. **This is
  intentional, not a bug** — the secret gates eval triggering and scores, and a
  `NEXT_PUBLIC_` copy would be readable in devtools.
- **SSE reconnect degrades to polling; it does not guarantee a persistent connection.** After 4
  consecutive failures the client stops retrying SSE and polls `GET /api/incidents` on an
  interval, re-probing SSE every 60s. The connection indicator reports the real transport state
  rather than optimistically claiming "live".
- **`GET /api/incidents` and `GET /api/incidents/stream` are unauthenticated.** Any client that
  can reach the backend can read every incident title, body, and classification. Only
  corrections are role-gated.
- **The frontend duplicates the backend's drift rule.** `frontend/features/eval-metrics/drift.ts`
  re-implements `DRIFT_THRESHOLD`, `ROLLING_WINDOW`, and `MIN_TRUSTWORTHY_SAMPLE` because
  `EvalRun` persists only the boolean `driftFlag`, not the threshold it was judged against. The
  constants are duplicated across two npm projects with no shared import path — change one,
  change the other.
- **Dedupe is an O(n) scan over all open incidents,** loading every embedding into memory per
  webhook. Fine at current volume; it will not hold at scale without a vector index.
- **No provider attribution on the incident row.** Which LLM classified an incident is logged
  but never persisted, so `ProviderTicker` renders nothing. Surfacing it needs a schema field.
- **No test suite.** Correctness rests on zod boundaries, TypeScript, and the eval gate.
- **Not deployed.** No hosting configuration exists in the repo. The worker needs an always-on
  process and the SSE route needs a long-lived connection, so neither fits a serverless
  function without changes.

## 🔮 Future Improvements

- **`GET /api/eval-runs` history route** — the single highest-value gap. It would take
  `/admin/metrics` out of degraded mode, restore the drift chart's gate line and rolling
  average, and make the `?jobId=` fallback path unnecessary. The frontend client
  (`listEvalRunsOrNull`) is already written against the agreed contract and resolves `null` on
  404, so shipping the route requires no frontend change.
- **Self-serve ONCALL promotion** — an admin-gated role management surface, replacing manual SQL.
- **Persist the classifying provider** on `Incident` (e.g. `classifiedBy`) so `ProviderTicker`
  can show real Groq/Cerebras attribution instead of rendering null.
- **Persist `rollingAvg` and `threshold` on `EvalRun`** so the frontend can draw the gate line
  from recorded fact instead of re-deriving the rule and risking drift between the two copies.
- **pgvector for dedupe** — replace the in-memory O(n) cosine scan with an indexed nearest-
  neighbour query.
- **Auth on the incident read paths** — close the unauthenticated list/stream endpoints.
- **Deployment** — frontend to a serverless host, backend + worker to an always-on container.
