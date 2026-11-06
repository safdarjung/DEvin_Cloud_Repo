# Deployment

Target: Vercel (vercel.json: framework nextjs) + hosted Supabase. No secrets here; values live in the host env.

## Env var names (.env.example)
- Supabase: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_DB_URL
- App: APP_URL (also canonical site origin for SEO; falls back to localhost:3000), CRON_SECRET (job runner auth; also salts lead IP hashes)
- Demo: DEMO_RESET_ALLOWED, SEED_DEMO_PASSWORD, DEMO_AUTO_LOGIN, DEMO_AUTO_LOGIN_AS, NEXT_PUBLIC_DEMO_LOGIN_HINTS
- AI: OLLAMA_BASE_URL, OLLAMA_MODEL, AI_CLOUD_ENABLED, ANTHROPIC_API_KEY, AI_CLOUD_MODEL_QUALITY, AI_CLOUD_MODEL_CHEAP, GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL, LAYA_BRIDGE_URL
- Channels: RESEND_API_KEY, RESEND_FROM, MSG91_AUTH_KEY, MSG91_WA_NUMBER, MSG91_WA_NAMESPACE
- Payments: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
- Ops/bench: SERVICE_ROLE_CALLER, BENCH_KWH_USD, BENCH_HW_USD_PER_HOUR, RESTORE_DB_URL, RESTORE_ALLOW_REMOTE_HOST

## Build
`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (Node >=22.12, pnpm 11). CI runs these plus tests (.github/workflows/ci.yml).

## Migrations
Append-only in supabase/migrations. Hosted pushes are owner-run: `pnpm exec supabase db push --linked --include-all` (HANDOFF). A pushed migration is frozen; fix forward with a new number.
- Pending on hosted: 20261028000100_platform_leads.sql (this branch). Until pushed, `/api/public/lead` fails with an internal error (RPC missing).
- After schema change: `pnpm db:types` (local Supabase) and commit src/lib/db/types.ts.

## Jobs
Hosted schedule: `node --env-file=.env.production.local scripts/hosted-schedule-jobs.ts` (pg_cron + pg_net; secret into Supabase Vault; APP_URL must be https). Endpoint: POST /api/jobs/run with CRON_SECRET. Job name in script: coolskool-jobs-run.

## Rollback
- App: Vercel redeploy/rollback of a previous deployment (platform feature; not scripted in repo).
- DB: no down migrations. Restore via scripts/db-backup.ts, db-restore.ts, db-drill.ts (`pnpm db:backup|db:restore|db:drill`). Restore drill never verified on this branch.

## Health and monitoring
No health endpoint and no error-monitoring SDK in src (grep for sentry/health/healthz found none). Use Vercel logs. `global-error.tsx` and route error boundaries exist for UI only.

## Post-deploy checks (manual)
/ , /sitemap.xml, /robots.txt, /llms.txt, /manifest.webmanifest load; /login works; submit /contact form (needs 0100); `/select` requires login.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
