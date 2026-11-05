Packet: M15-T5 Migration 0077 part 3 — enqueue_due_reports sweep
Files changed: supabase/migrations/20261028000077_scheduled_reports.sql (appended part 3); tests/db/report-sweep-rpc.test.ts (new); src/lib/db/types.ts (regen, additions only)
Behavior implemented: public.enqueue_due_reports() returns int — plpgsql, security definer, search_path='', FOR loop over up to 200 active/due/module-enabled scheduled_reports rows (FOR UPDATE SKIP LOCKED), calls app.enqueue_job per row (payload {scheduled_report_id, fire_at}, key report.generate:<id>:<UTC stamp>), advances next_run_at via app.cron_next_fire(cron, tz, greatest(next_run_at, now())). Revoked from public/anon/authenticated, granted to service_role only.
Tests run: pnpm db:reset (clean); pnpm db:types (additions only, 39 lines, includes T3/T4 rows already pending in tree); pnpm test:db tests/db/report-sweep-rpc.test.ts → 7 passed, 7 total; pnpm lint → clean; pnpm typecheck → clean
Tests not run and why: pnpm test:security — not re-run (no RLS/grant table changed by this part beyond function grants already covered by the 42501 test; T3/T4 own that suite's assertions)
Limitations / honesty label: n/a (backend sweep, no UI)
Security / integration risks: enqueue_due_reports is a global sweep with no institution filter (by design, matches 0003's claim_job shape); execute restricted to service_role via grant, verified by test ("admin → 42501"). Module-off rows are left untouched per MOD semantics (row sits overdue until module re-enabled, then fires once) — matches ruling exactly.
Follow-ups: none
New dependencies (justification): none
Assumptions made: none — rulings text (Scheduling, Idempotency) was followed verbatim for payload/key/next_run_at shape.
