# T-037 — Jobs runner (route + CLI), handlers skeleton, requeue page

| Field | Value |
|---|---|
| Lane / Day | D / Day 7 |
| Size | 1 agent-day |
| Critical path | no (T-038, T-031 job path depend on it) |
| Review | security-reviewer + lead |
| Feature ids | F-PLT-01 |
| Depends on | T-005, T-007 (merged) |
| Migration | — |

## Business outcome
Background work (notifications, bulk invoices) runs reliably with retries, idempotency, and a dead-letter view, without any queue service.

## Current repo state (verify before starting)
- `jobs` table, `app.claim_job`, `app.enqueue_job`: `grep -n "claim_job\|enqueue_job\|create table public.jobs" supabase/migrations/20261028000003_platform.sql`.
- Admin client guard: `grep -n "SERVICE_ROLE_CALLER" src/lib/supabase/admin.ts`.
- Env names present in `.env.example`: `grep -n "CRON_SECRET" .env.example`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W12` · `04-architecture.md §7, §3` (jobs route row) · `07 §4` (service-role allow-list row for the runner), `§1 T7` · `08 §3 C-70..C-72` · `11 §5`.

## Files to inspect first
`src/lib/supabase/admin.ts` · `supabase/migrations/20261028000003_platform.sql` (`claim_job` signature, statuses) · `src/lib/actions/result.ts`.

## Expected changes
- `src/modules/jobs/types.ts` — `JobHandler = (job, deps) => Promise<void>`, `JobType` union (`notify.attendance_absence`, `notify.results_published`, `notify.recheck_decided`, `notify.enquiry_received`, `notify.enrolment_welcome`, `finance.generate_term_invoices`).
- `src/modules/jobs/registry.ts` — map type → handler; unknown type → fail with `last_error = 'unknown_type'` (no retry).
- `src/modules/jobs/handlers/index.ts` — placeholder handlers that throw `not_implemented` for notification types (T-038 replaces) and finance (T-031 replaces).
- `src/modules/jobs/runner.ts` — `runOnce({ budgetMs: 50_000, max: 50, workerId })`: reclaim stale `running` (> 10 min) → loop `app.claim_job` → handler → `succeeded` | requeue with `run_after = now + 2^attempts min` | `dead` when `attempts >= max_attempts`; structured logs with correlation id, never payload PII.
- `src/app/api/jobs/run/route.ts` — POST/GET with `Authorization: Bearer $CRON_SECRET` (constant-time compare); sets `SERVICE_ROLE_CALLER=jobs` scope; returns counts.
- `scripts/jobs-run.ts` — CLI wrapper (`pnpm jobs:run`), optional `--loop` for dev.
- `src/modules/jobs/queries.ts`, `actions.ts` (`requeueJob`, `job.manage`), page `src/app/(tenant)/[institution]/jobs/page.tsx` listing failed/dead with error and requeue.
- `tests/db/jobs.test.ts`, `tests/unit/jobs-runner.test.ts`.

## Must not modify
Migrations · `src/lib/supabase/admin.ts` · notification handlers' content (T-038).

## Permissions / nav / migration numbers needed from the lead
Nav: `{ href: '/jobs', label: 'Jobs', permission: 'job.manage' }`.

## Security and data-integrity requirements
- Route rejects missing/wrong secret with 401 before touching the DB; no institution scoping needed (platform runner), but the admin page uses the user client (RLS limits to own institution).
- Handlers receive the service-role client only via `deps`; they must be idempotent (document the rule in `types.ts` JSDoc).
- Backoff and dead-letter transitions happen in one UPDATE each; never lose a job on handler exception (try/finally).

## Acceptance criteria
1. Two concurrent `runOnce` calls never process the same job (C-70).
2. A handler that throws three times is retried with 2, 4, 8 minute delays and dies on the 5th attempt (C-71) — tested with `max_attempts` lowered in the fixture.
3. Enqueuing the same idempotency key twice yields one job (C-72).
4. `curl -H "Authorization: Bearer wrong" /api/jobs/run` → 401; correct secret → JSON counts.
5. Admin requeues a dead job; it becomes `queued` with `attempts = 0`.

## Tests (write failing tests first) and exact commands
- `tests/db/jobs.test.ts` (C-70, C-71, C-72, stale reclaim) → `pnpm test:db -- tests/db/jobs.test.ts`
- `tests/unit/jobs-runner.test.ts` (dispatch, unknown type, budget stop) → `pnpm test -- tests/unit/jobs-runner.test.ts`

## Deliverables
Runner, registry, route, CLI, admin page, tests, completion report.

## Assumptions and risks
- Vercel cron every 5 min is adequate for the demo; the E2E helper (T-041) triggers the route directly.
- `claim_job` signature from 0003 is authoritative; if it lacks `worker_id`, request a fix migration number rather than editing 0003.

## Completion report
Use the format in `CLAUDE.md`.
