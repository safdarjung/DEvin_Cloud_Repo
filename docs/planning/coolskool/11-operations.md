# 11 — Operations

## 1. Environment variables (names only; values never in the repo)

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase API URL (`http://127.0.0.1:54321` locally) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | Publishable (anon) key for browser/server user clients |
| `SUPABASE_SECRET_KEY` | server, scripts | Service-role/secret key; allow-listed callers only (`07 §4`) |
| `SUPABASE_DB_URL` | scripts, tests | Direct Postgres URL for seed bulk functions and test setup (local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`) |
| `APP_URL` | server | Absolute URL for links in notifications |
| `CRON_SECRET` | server | Bearer token for `/api/jobs/run` |
| `DEMO_RESET_ALLOWED` | server, scripts | `true` enables `demo:reset` |
| `SEED_DEMO_PASSWORD` | scripts | Password for seeded demo users (default documented in §3, demo tenant only) |
| `OLLAMA_BASE_URL` | server | Default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | server | Default `qwen3:4b-instruct-2507-q4_K_M`; fallback `qwen2.5:3b` |
| `AI_CLOUD_ENABLED` | server | Global cloud switch, default `false` |
| `ANTHROPIC_API_KEY` | server | Optional; absent in the demo |
| `AI_CLOUD_MODEL_QUALITY` / `AI_CLOUD_MODEL_CHEAP` | server | Defaults `claude-sonnet-5` / `claude-haiku-4-5` |
| `NEXT_PUBLIC_DEMO_LOGIN_HINTS` | all | `true` shows the demo account list on the login page (demo deployments only; DBT-11) |
| `SERVICE_ROLE_CALLER` | scripts, jobs | Set by entrypoints to `seed`, `reset`, or `jobs`; the admin client refuses otherwise |
| `BENCH_KWH_USD`, `BENCH_HW_USD_PER_HOUR` | bench | Cost assumptions for local inference (flagged in output) |

`.env.example` lists all names with comments; `.env.local` is git-ignored. CI uses repository secrets only for the deploy job.

## 2. Local setup

```
pnpm install
pnpm db:start            # supabase start (Docker); prints local keys → copy into .env.local
pnpm db:reset            # applies migrations, regenerates types, runs seed
pnpm dev                 # http://localhost:3000
ollama pull qwen3:4b-instruct-2507-q4_K_M   # once; optional for non-AI work
```

Ports: API 54321, Postgres 54322, Studio 54323, Mailpit 54324. `supabase/config.toml` keeps `api.schemas = ["public","storage","graphql_public"]` so the `app` schema is never exposed.

## 3. Demo tenant and logins

Institution `st-josephs-demo` ("St. Joseph's Convent School (Demo)", `is_demo = true`). Users (`@demo.coolskool.test`): `principal`, `admin`, `admissions`, `accountant`, `examcontroller`, `teacher.vi-a`, `teacher.viii-b`, `teacher.x-a` (also teaches X-A Mathematics), `guardian.one` (Priya Sharma; children Aarav in VI-A and Ananya in X-A), `guardian.two` (Rohit Mehta; Ishaan in VIII-B), `student.one` (Ananya Sharma). Named entities for the script: `05 §8.1`. Password from `SEED_DEMO_PASSWORD` (default `CoolSkool-Demo-2026`; change on hosted). The login page lists these when `NEXT_PUBLIC_DEMO_LOGIN_HINTS=true` (anon cannot read `institutions`; recorded as DBT-11), under the heading "Demo accounts".

Dev/demo separation: the demo institution is the only `is_demo = true` tenant; reset and seed refuse everything else. A second non-demo institution exists only in test fixtures.

## 4. Hosted setup

1. User creates the Supabase project in `ap-south-1`; records URL, publishable key, secret key, DB URL in Vercel env (never in the repo).
2. `pnpm supabase link --project-ref <ref>` → `pnpm supabase db push` (applies 0001–0010 + fixes).
3. Auth settings: email/password enabled, confirmations off for demo, site URL = Vercel URL; rate limits default.
4. `SERVICE_ROLE_CALLER=seed DEMO_RESET_ALLOWED=true pnpm seed` against hosted (from the laptop, using hosted env).
5. Vercel: import repo, framework Next.js, env vars from §1, cron `*/5 * * * *` → `/api/jobs/run` with `CRON_SECRET` header; deploy `main`.
6. Smoke: J-00, J-01, J-02; then full narrative.
7. Backup/restore drill (§6).

## 5. Seed, reset, and jobs

- `pnpm seed` — idempotent on an empty demo tenant; aborts if the demo institution already has students unless `DEMO_RESET_ALLOWED=true` (then resets first).
- `pnpm demo:reset` — `app.demo_reset` + seed; prints counts and duration.
- `pnpm jobs:run` — processes queued jobs once (use in dev instead of cron); `/api/jobs/run` is called by Vercel Cron in demo.
- Job health: `/[institution]/jobs` lists failed/dead with errors and requeue.

## 6. Backup and restore

Backup: `pnpm supabase db dump --db-url "$SUPABASE_DB_URL" -f backups/<date>-schema.sql` and `--data-only -f backups/<date>-data.sql` (backups directory git-ignored). Restore drill: create a Supabase branch or a second local instance, `psql < schema.sql`, `psql < data.sql`, run J-00. Hosted project daily backups (Supabase default on paid tiers) are noted as the production path; the demo relies on `demo:reset` for recovery.

## 7. Google sign-in (documented, not configured)

Create an OAuth client in Google Cloud (web), authorized redirect `https://<project>.supabase.co/auth/v1/callback`, enable the Google provider in Supabase Auth with client id/secret, add `signInWithOAuth({ provider: 'google' })` to the login page, map `profiles` by email on first login, and require an existing membership (no auto-provisioning). Planned (F-IDN-08).

## 8. Hybrid and institution-controlled hosting (documented path)

Same migrations and app build. Institution server: Docker Compose with self-hosted Supabase (Postgres, Auth, PostgREST, Storage, Kong) + `next start` container + Ollama with GPU. Cloud fallback governed by `ai_policy` and `AI_CLOUD_ENABLED`. Sizing method (not a recommendation): from `pnpm ai:bench` primitives — service time S at concurrency 1, throughput knee T(c), VRAM peak, validity %, cost per 1k — compute `demand/h = teachers × requests/teacher/h × peak factor`, required concurrency `= demand × S / 3600`, compare with the knee, apply 30–50% headroom, and compute the local-vs-cloud cost crossover. Record every assumption; publish only after measurements on real usage.

## 9. Monitoring and troubleshooting

| Symptom | Check |
|---|---|
| Login loops | Proxy cookie refresh; `NEXT_PUBLIC_SUPABASE_*` values; clock skew |
| `forbidden` on every action | Membership `status`, role spelling, `ROLE_PERMISSIONS` entry |
| Empty lists for a valid user | RLS helper (`app.is_member`) vs membership; run the generated suite for that table |
| Notifications not arriving | Jobs queued but runner not called → `pnpm jobs:run`; dead jobs page |
| AI `ai_unavailable` | `ollama ps`, `OLLAMA_BASE_URL`, VRAM free (`nvidia-smi`), model pulled; policy |
| Slow `db:reset` | Attendance seed size; Docker resources |
| Hosted build fails | Node 22 engine, env names, `cacheComponents: false` in `next.config.ts` |

Logging: server logs include correlation ids and error codes, never prompt bodies, env values, or PII beyond ids. Vercel logs + Supabase logs are the demo monitoring surface; no APM.

## 10. Demo script (13 steps, target < 25 minutes; entities from `05 §8.1`)

| # | Min | Login | Do | Say |
|---|---|---|---|---|
| 1 | 0–2 | visitor | Open `/s/st-josephs-demo`, scroll notices and events | "Your school's website, edited by your office, no agency" |
| 2 | 2–3 | visitor | Submit enquiry for "Meera Kapoor", grade I, phone `9800000777` | "Every enquiry lands in admissions instantly" |
| 3 | 3–6 | admissions | Pipeline board: move Meera to Contacted; open `APP-live-1` (Riya Verma) | "Nothing is lost between phone calls" |
| 4 | 6–7 | admissions | Decision: accept `APP-live-2` is already accepted; show the decision trail | "Who decided, when, with what note" |
| 5 | 7–10 | admissions | Enrol Riya into I-C; enrol Kabir Mehta into VI-B; open Kabir's profile: guardian `9800000002` already existed | "One click: admission number, parent, section, first invoice; the same parent is not duplicated" |
| 6 | 10–12 | teacher.vi-a | Mark today's VI-A: Aarav Sharma + one more absent; submit; open message log | "Parents know by 10 am; SMS shown as simulated here" |
| 7 | 12–15 | accountant → guardian.one | Record ₹ cash payment on Aarav's Term 2 invoice; print receipt; log in as the parent: two children, absence alert, paid invoice, receipt | "What a parent sees on the phone" |
| 8 | 15–18 | teacher.x-a | Unit "Quadratic Equations" → Generate quiz (local AI) → edit one question → save → publish | "AI drafts, teacher decides; runs on a laptop, no data leaves the school" |
| 9 | 18–20 | examcontroller | `PT2-X`: verification shows X-A Mathematics missing; enter marks; verification clean | "The system refuses to publish incomplete results" |
| 10 | 20–21 | examcontroller → guardian.one | Publish; parent sees Ananya's report card | "252 report cards in one click, with grades per your scale" |
| 11 | 21–22 | guardian.one | Request recheck on Mathematics with a reason | "Parents can ask, with a record" |
| 12 | 22–24 | examcontroller | Approve with new marks; parent sees "Corrected on …"; controller sees version history | "Original never disappears" |
| 13 | 24–25 | principal | Dashboard: today's attendance, collections, funnel, grade distribution | "Everything you asked your staff for this morning, live" |

Reset between runs: `pnpm demo:reset` (≈ seed time). If the venue has no connectivity, play the screen recording (`09 §8`).

## 11. Production-readiness gaps (after the demo)

Real SMS/email providers (DLT registration), payment gateway, CSV import, backups policy and retention, consent records (DPDP), rate limiting at the edge (WAF/CAPTCHA), observability (APM, alerts), custom domains, storage policies for documents, multi-campus UI, table-driven permissions, void/refund flows, pen test by a third party.

## 12. Environment matrix

| Variable | Local dev | CI | Hosted demo |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._PUBLISHABLE_KEY` | from `supabase start` | from `supabase start` in the job | Vercel env (project settings) |
| `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` | local values | local values | Vercel env (server only) and the operator's shell for seed |
| `DEMO_RESET_ALLOWED` | `true` | `true` | `true` only on the demo project |
| `NEXT_PUBLIC_DEMO_LOGIN_HINTS` | `true` | `false` | `true` |
| `AI_CLOUD_ENABLED` / `ANTHROPIC_API_KEY` | `false` / unset | `false` / unset | `false` / unset (until a key exists) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | unset (AI tests mocked; C-65 skipped) | laptop tunnel URL only during step 8, else unset → `ai_unavailable` message |
| `CRON_SECRET` | any string | any string | Vercel env; Vercel Cron sends it |
| `SEED_SCALE` | `full` | `small` | `full` |

## 13. Runbooks

| Situation | Steps |
|---|---|
| Reset needed between two demo runs | `DEMO_RESET_ALLOWED=true SERVICE_ROLE_CALLER=reset pnpm demo:reset` with hosted env; confirm counts page; log in as `principal` to warm the dashboard |
| Jobs stuck (notifications missing) | Open `/jobs`; if queued jobs are old, hit `/api/jobs/run` with the secret or run `pnpm jobs:run` against hosted env; requeue dead jobs |
| Ollama down at the venue | Step 8 shows the honest `ai_unavailable` message; say so, then show a pre-generated quiz saved as a draft assignment the day before (labelled "AI draft, generated on <date>") |
| Wi-Fi loss | Switch to the screen recording; resume live at the next step when connectivity returns |
| Wrong data entered during the demo | Continue; corrections are part of the story (attendance correction, recheck); reset after the session |
| Hosted migration fails on `db push` | Do not edit merged migrations; add a numbered fix migration (`10 §3`), test locally with `db reset`, push again |
| Suspected leak or security finding | `07 §8` |

## 14. Onboarding a real school in 3 days (M03–M04 APIs)

Every step is an API call (`docs/planning/fabric/07-master-plan-v1-v2.md` D40/D41); the UI pass wraps the same calls. Auth is the session cookie or `Authorization: Bearer <Supabase access token>`; tenant calls carry `{"institution": "<slug>", "input": {…}}`. `GET /api/v1/actions` and `GET /api/v1/query` list every name with its input schema.

| Day | Who | Steps |
|---|---|---|
| Before day 1 | School | Send the filled templates `public/templates/students.csv` and `public/templates/staff.csv` (header row is the contract; dates `YYYY-MM-DD`; phones 10 digits starting 6–9, `+91`/spaces/dashes are stripped). |
| Day 1 — tenant + data | Owner (signs up via Supabase auth) | `POST /api/v1/institutions` `{name, slug, timezone?, yearStart?}` → creates the school, the owner's staff row and membership, the current academic year (1 April) and two terms. Then structure first: `people.department.upsert`, `academics.grade.upsert`, `academics.subject.upsert`, `academics.section.upsert` (sections must exist before students import — rows resolve `grade` + `section` in the current year). Then `data.import.stage` `{entityType: "staff", fileName, csv}` → fix reported rows (CSV line numbers) → `data.import.commit` `{batchId}`; same for `students`. Re-committing a batch is a no-op; re-staging the fixed file skips rows already imported (admission_no / employee_no / guardian phone). |
| Day 2 — teaching + money | Principal/admin, accountant | `academics.subjectAssignment.set` per section × subject × teacher; timetable (M7, when shipped); fee structures (`finance.structure.upsert`, `finance.structure.assign`) and term invoices (`finance.invoice.generateTerm`). Check counts with `GET /api/v1/query/people.listStudents?format=csv`. |
| Day 3 — people + go-live | Owner/principal | `core.member.invite` per staff member (`staffId`) and guardian (`guardianId`) → share the returned link (delivery is simulated until M17 — badge shown) → invitee signs up with the same email and calls `POST /api/v1/invitations/accept` `{token}`. Disable mistakes with `core.member.setStatus`. 30-minute training per role on attendance, marks, payments. |

Limits: one CSV ≤ 1 MB and ≤ 5,000 rows; fee-structure and marks CSV import are not built (DBT-44) — use the batch actions. Invitations expire after 7 days and are single-use.
