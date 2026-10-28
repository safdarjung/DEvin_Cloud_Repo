# T-005 — Migration 0003: audit, jobs, notifications, AI usage + RLS

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 3 |
| Size | 1 agent-day |
| Critical path | no |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-12, F-PLT-01, F-COM-01, F-COM-02, F-AI-01 |
| Depends on | T-004 (merged) |
| Migration | `supabase/migrations/20261028000003_platform.sql` |

## Business outcome
Append-only audit, a reliable job queue, in-app notifications with channel delivery records, and AI metering exist before any lane needs to enqueue work or log an event.

## Current repo state (verify before starting)
- 0001 and 0002 applied: `ls supabase/migrations/ | wc -l` → 2.
- `app.audit` not yet defined: `psql "$SUPABASE_DB_URL" -c "\df app.audit"`.

## Spec sections to read (only these)
- `05-data-architecture.md §2.1` (rows audit_events…ai_usage_events), `§5` (classes A, O), `§6` (append-only).
- `06-workflows-and-contracts.md §W12` (claim/enqueue semantics, stale reclaim), `§4` (audit action catalog).
- `07-security-and-ai-governance.md §4` (allow-list rows for `claim_job`, `enqueue_job`, `audit`), `§5` (no prompt bodies).
- `12-decision-log.md` D10, D20.

## Files to inspect first
- 0001 (`block_mutation`, helper signatures), 0002 (`memberships` revision trigger expectations).

## Expected changes
- `20261028000003_platform.sql`: `audit_events`, `jobs`, `notifications`, `delivery_attempts`, `ai_usage_events` per `05 §2.1`; `block_mutation` triggers on `audit_events`, `delivery_attempts`, `ai_usage_events` (UPDATE/DELETE).
- `app.audit(...)` security definer insert; `app.membership_changed()` trigger fn (called from the 0002 trigger) writing before/after.
- `app.enqueue_job(institution_id, type, payload, idempotency_key)` → `on conflict (idempotency_key) do nothing`, returns id.
- `app.claim_job(worker_id)` → one `queued` job with `run_after <= now()` via `for update skip locked`, sets `running`, `locked_at`, `locked_by`, `attempts + 1`; also reclaims `running` rows older than 10 min.
- `app.complete_job(id, ok, error)` → `succeeded`, or `queued` with `run_after = now() + (2^attempts) minutes`, or `dead` at `max_attempts`.
- Unique index `notifications (institution_id, (data->>'key'))` where key not null (handler idempotency).
- RLS: `audit_events` class A (SELECT owner/principal/admin; no writes); `jobs` SELECT/UPDATE(status requeue) owner/principal/admin, no INSERT policy; `notifications` class O (SELECT own, UPDATE own `read_at` only via column-restricted policy + trigger); `delivery_attempts` SELECT by `app.has_role(institution_id, '{owner,principal,admin,admissions}')`; `ai_usage_events` SELECT owner/principal/admin, no writes.
- Grants: `execute` on `enqueue_job` to `authenticated` (checked internally with `app.is_member`), `claim_job`/`complete_job` revoked from `anon, authenticated` (service role only).
- Regenerate types.

## Must not modify
- 0001, 0002 (except nothing — the 0002 trigger already calls `app.membership_changed`).

## Permissions / nav / migration numbers needed from the lead
- Migration number 0003 reserved here.

## Security and data-integrity requirements
- `ai_usage_events` has no text column for prompts/outputs (schema enforces `07 §5`).
- `audit_events` UPDATE/DELETE always raise, even for service role (trigger, not policy).
- `claim_job` must never hand the same job to two workers (C-70).

## Acceptance criteria
1. `pnpm db:reset` green; types regenerated.
2. C-07: UPDATE/DELETE on `audit_events` raises for owner and service role.
3. C-70: two concurrent `claim_job` calls on one queued job return one job and one null.
4. C-71: `complete_job(ok=false)` requeues with later `run_after`; after `max_attempts` status is `dead`.
5. C-72: duplicate `idempotency_key` yields one row.
6. C-30: user A cannot SELECT user B's notifications; A can set only `read_at` on own row.
7. Membership status change produces an `audit_events` row with before/after.

## Tests (write failing tests first) and exact commands
- `tests/db/platform.test.ts` — C-07, C-70, C-71, C-72, C-30, membership audit.
- Command: `pnpm test:db -- tests/db/platform.test.ts`.

## Deliverables
- Migration 0003, types, tests, completion report.

## Assumptions and risks
- Backoff uses minutes; cron runs every 5 min in demo, so the first retry effectively waits one cron tick.
- `jobs.institution_id` nullable for platform-level jobs; RLS SELECT excludes null-institution jobs for tenant admins.

## Completion report
Use the format in `CLAUDE.md`.
