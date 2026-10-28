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

## 2. Local setup (Day 1 onward)

```
pnpm install
pnpm db:start            # supabase start (Docker); prints local keys → copy into .env.local
pnpm db:reset            # applies migrations, regenerates types, runs seed
pnpm dev                 # http://localhost:3000
ollama pull qwen3:4b-instruct-2507-q4_K_M   # once; optional for non-AI work
```

Ports: API 54321, Postgres 54322, Studio 54323, Mailpit 54324. `supabase/config.toml` keeps `api.schemas = ["public","storage","graphql_public"]` so the `app` schema is never exposed.

## 3. Demo tenant and logins

Institution `st-josephs-demo` ("St. Joseph's Convent School (Demo)", `is_demo = true`). Users (`@demo.coolskool.test`): `principal`, `admin`, `admissions`, `accountant`, `examcontroller`, `teacher.vi-a`, `teacher.viii-b`, `teacher.x-a`, `guardian.one` (two children), `guardian.two`, `student.one`. Password from `SEED_DEMO_PASSWORD` (default `CoolSkool-Demo-2026`; change on hosted). The login page lists these when `NEXT_PUBLIC_DEMO_LOGIN_HINTS=true` (anon cannot read `institutions`; recorded as DBT-11), under the heading "Demo accounts".

Dev/demo separation: the demo institution is the only `is_demo = true` tenant; reset and seed refuse everything else. A second non-demo institution exists only in test fixtures.

## 4. Hosted setup (Day 18)

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

## 6. Backup and restore (executed once on Day 18)

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

## 10. Demo script (13 steps, target < 25 minutes)

1. Public site → 2. Submit enquiry → 3. Admissions pipeline (login `admissions`) → 4. Decision → 5. Enrol (show admission no, guardian, section, invoice) → 6. Teacher attendance (`teacher.vi-a`), two absences, message log → 7. Guardian portal (`guardian.one`): attendance, fees, receipt → 8. Teacher: unit → AI quiz (local) → review → publish → guardian sees assignment → 9. Exam controller: marks entry + verification → 10. Publish → guardian report card → 11. Guardian recheck request → 12. Controller decision → corrected result → 13. Principal dashboard. Reset between runs: `pnpm demo:reset`.

## 11. Production-readiness gaps (after the demo)

Real SMS/email providers (DLT registration), payment gateway, CSV import, backups policy and retention, consent records (DPDP), rate limiting at the edge (WAF/CAPTCHA), observability (APM, alerts), custom domains, storage policies for documents, multi-campus UI, table-driven permissions, void/refund flows, pen test by a third party.
