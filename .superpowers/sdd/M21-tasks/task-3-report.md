Packet: M21-T3 Migration 0094 part 2 — series functions + sweep
Files changed: supabase/migrations/20261028000094_forecasts.sql (appended); tests/db/forecasts-sql.test.ts (new); src/lib/db/types.ts (regen, +16 additive); tests/security/grants.test.ts (edit, +4 names in `serviceOnly`).
Behavior implemented: public.forecast_fee_series (contiguous term windows, payment_reversals/cancelled-invoice exclusion, exact paise), public.forecast_attendance_series (0009-style counts_present/in_denominator weighting, period/open-session exclusion, school-wide = Σsections), public.enqueue_due_forecasts (per-institution-per-day forecast.run sweep). Both series fns `security invoker`, service-role-only, per rulings. Validation helper `public.assert_forecast_window` kept in `public` (not `app`): an app.* fn reachable by service_role fails grants.test.ts's "no app fn granted to service_role" check, since new app fns default to PUBLIC execute until revoked (0003 lesson) and app has no default-privilege override for service_role (unlike public, 0046).
Prior blocker (payment_reversals/0074 missing) resolved: lane merged main (b5d6fff) since the earlier interrupted run; 0074 is now present and clean.
Tests run: pnpm db:reset (clean, full seed ok) -> pnpm test:db tests/db/forecasts-sql.test.ts tests/db/forecasts-rls.test.ts: 2 files, 19/19 pass -> pnpm test:security tests/security/grants.test.ts: 1 file, 9/9 pass -> pnpm lint: clean -> pnpm typecheck: clean.
Tests not run and why: full test:db/test:security suites not run (not in ACCEPT list; concurrent lane agents share the DB).
Limitations / honesty label: n/a (no user-facing surface yet; T9-T12 land queries/docs).
Security / integration risks: none found; verified 42501 for authenticated on all 3 new RPCs, success for service_role; window>400d raises validation_failed; reversed/cancelled/cross-institution rows correctly excluded.
Follow-ups: none new.
New dependencies: none.
Assumptions made: validation helper placed in public schema (not app) to satisfy existing grants.test.ts invariant — see rationale above; not spelled out in rulings but required by BRIEF-COMMON's existing test contract.
