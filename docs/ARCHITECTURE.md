# Architecture

## Layout
- `src/app/(marketing)` public site; `(auth)/login`; `(tenant)/[institution]/...` app; `s/[slug]` public school site; `select`; `offline`.
- API routes: `/api/v1/actions` (action dispatcher), `/api/v1/query` (query registry), `/api/v1/institutions`, `/api/v1/invitations`, `/api/ai/{agent,attendance-insight,dashboard-briefing,enquiry-reply,genui-route,quiz,report-remark}`, `/api/jobs/run`, `/api/public/{enquiry,lead,payments}`.
- `src/modules/<domain>`: schemas, actions, queries, components per domain (academics, admissions, agents, ai, attendance, calendar, certificates, core, diary, documents, exam-seating, exams, fabric, facilities, finance, forecasts, imports, insights, jobs, library, lifecycle, notifications, people, ptm, question-bank, reports, student-leave, timetable, transport, visitors, website).
- `src/lib`: auth, actions, ai, db (generated types), genui, http, marketing, modules (catalog), schemas, supabase, audit.ts, nav.ts, bottom-nav.ts, site-url.ts.

## Request model
1. `src/proxy.ts` refreshes the Supabase session (`getClaims`) and handles demo auto-login and login redirects. It is not authorization.
2. Every action: `defineAction(schema, permission, handler)` parses input with Zod, resolves tenant context, checks membership and `requirePermission`, returns `{ok,data}|{ok:false,error}`. 156 call sites. Actions must be imported in `src/app/api/v1/actions/all-actions.ts` (HANDOFF).
3. Data layer: Postgres RLS on tenant tables (`institution_id`). Service-role client only in seed/reset, job runner, allow-listed definer paths.
4. Immutable history: payments, receipts, results, marks, audit_events (triggers; corrections insert new versions).

## Jobs
`/api/jobs/run` guarded by `CRON_SECRET`. Hosted scheduling via pg_cron + pg_net (`scripts/hosted-schedule-jobs.ts`), not Vercel Cron.

## AI
All model calls go through `src/lib/ai/gateway.ts` (see AI_AND_BILLING.md).

## Fabric UI
`/fabric/*` pages (12) use fixtures in `src/modules/fabric/demo`; types in `src/modules/fabric/types.ts`. They do not call real backends.

## Wave 1 additions
- Lead capture: `POST /api/public/lead` -> Zod `LeadInputSchema` (16 KB body cap, honeypot field `website`) -> RPC `submit_platform_lead` (service role; table `platform_leads` has RLS on, no policies, anon/authenticated revoked). IP stored only as salted SHA-256 (salt derived from `CRON_SECRET` + date).
- PWA: `manifest.ts`, `public/sw.js` (caches public marketing shell + `/offline` only; never api/login/portal/tenant), `components/pwa/register.tsx`.
- Marketing path reservation: `src/lib/marketing/routes.ts` lists first segments no institution slug may use; `public/sw.js` duplicates the list by hand.

## Config
`next.config.ts`: `cacheComponents: false`, Turbopack Tailwind rule. `vercel.json`: framework nextjs. No custom security headers configured (verified: none in next.config.ts or src).

## Tests
Vitest projects unit / db / security; Playwright e2e. CI (.github/workflows): ci.yml (lint, typecheck, unit, seed, db, security, build), e2e.yml (nightly), secrets.yml (gitleaks).

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
