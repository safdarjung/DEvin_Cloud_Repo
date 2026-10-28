# T-044 — Deploy: hosted Supabase + Vercel, backup/restore once

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 18 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-PLT-05, F-PLT-08 |
| Depends on | T-041, T-042 (merged) |
| Migration | — |

## Business outcome
The demo runs from Vercel and a Mumbai-region Supabase project, with cron-driven jobs, seeded data, and a proven backup/restore path, so the rehearsal and the school visit do not depend on the laptop.

## Current repo state (verify before starting)
- Local full suite green: `pnpm test && pnpm test:db && pnpm test:security && pnpm build`.
- No hosted project yet: the user creates it in `ap-south-1` and provides URL/keys via Vercel env (never in the repo). Confirm `vercel whoami` works.
- `.env.example` complete: `diff <(grep -o '^[A-Z_]*' .env.example | sort) <(grep -o '`[A-Z_]*`' docs/planning/coolskool/11-operations.md | tr -d '\`' | sort -u)`.

## Spec sections to read (only these)
- `11-operations.md §1` (env names), `§4` (hosted steps 1–7), `§5` (cron, jobs), `§6` (backup/restore), `§9` (troubleshooting).
- `08-testing-and-acceptance.md §7` (checkpoint and G-2 gates), `§4` J-00…J-02.
- `04-architecture.md §8` mode A; `12` D18, D23.

## Files to inspect first
- `.github/workflows/ci.yml` (deploy job absent by design — Vercel Git integration deploys `main`), `next.config.ts`, `supabase/config.toml` (auth settings to mirror on hosted).

## Expected changes
- `vercel.json` — `crons: [{ path: "/api/jobs/run", schedule: "*/5 * * * *" }]`; the route checks `Authorization: Bearer $CRON_SECRET` (Vercel sends it when `CRON_SECRET` is set).
- Supabase: `pnpm supabase link --project-ref <ref>`; `pnpm supabase db push`; dashboard auth settings (email/password on, confirmations off, site URL); verify `app` schema not exposed (`Settings → API → Exposed schemas`).
- Seed against hosted from the laptop with hosted env in a shell session only (`SERVICE_ROLE_CALLER=seed DEMO_RESET_ALLOWED=true pnpm seed`).
- Vercel project: import repo, env vars per `11 §1` (production + preview), `NEXT_PUBLIC_DEMO_LOGIN_HINTS=true`, `AI_CLOUD_ENABLED=false`, `OLLAMA_BASE_URL` unset on Vercel (local AI is shown from the laptop; the hosted app shows `ai_unavailable` honestly unless a tunnel is configured — record decision).
- Backup drill per `11 §6`: dump schema + data to `backups/` (git-ignored), restore into a fresh local Supabase, run J-00; record timings in `docs/planning/coolskool/results/deploy-18.md`.
- Hosted checkpoint: `pnpm test:e2e` with `PLAYWRIGHT_BASE_URL=<vercel url>` for J-00…J-13; `pnpm test:security` against hosted fixture institutions is **not** run (fixtures would be created in production) — run the read-only subset (C-80, C-62/63 unit) and note it.
- `README.md` — "Demo deployment" section linking `11 §4`.

## Must not modify
- Migrations; application code except config files above (bugs found here get their own reserved number / fix commit with the lead).

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- Never print keys, DB URLs, or the demo password in logs, commits, or the completion report.
- Demo password on hosted is set via `SEED_DEMO_PASSWORD` to a new value known to the user only.
- `DEMO_RESET_ALLOWED` is unset on Vercel after seeding unless the rehearsal needs the in-app reset (then limited to the platform admin user).

## Acceptance criteria
1. Hosted URL serves the public site `/s/st-josephs-demo` and login works for all demo accounts.
2. Migrations 0001–00NN applied on hosted (`supabase migration list` shows all remote); `app` schema not exposed.
3. Cron invocation visible in Vercel logs; a queued job is processed within 5 minutes.
4. J-00…J-13 pass against hosted (AI step passes with a documented local-tunnel setup or is marked `ai_unavailable` with the honesty message shown — state which).
5. Backup/restore drill completed once; durations recorded in `results/deploy-18.md`.
6. `pnpm demo:reset` against hosted completes and the narrative is green afterwards.

## Tests (write failing tests first) and exact commands
- `PLAYWRIGHT_BASE_URL=<url> pnpm test:e2e`; `pnpm test -- tests/security/ai-egress.test.ts`.
- Backup/restore commands from `11 §6`.

## Deliverables
- `vercel.json`, hosted project configured, seed applied, results file, README section, completion report with the AI-on-hosted decision.

## Assumptions and risks
- Supabase `ap-south-1` capacity and key naming may differ (`D23`); map keys and record.
- Vercel cron needs a deployed `CRON_SECRET`; preview deployments do not run cron.
- If the hosted project is unavailable on Day 18, run the full rehearsal locally and use Day 20 for deploy (fallback recorded in `09 §7`).

## Completion report
Use the format in `CLAUDE.md`.
