Packet: M21-T2 Migration 0094 part 1 — tables, constraints, RLS
Files changed: supabase/migrations/20261028000094_forecasts.sql (new); tests/db/forecasts-rls.test.ts (new); tests/security/rls-expectations.ts (edit, 2 entries); src/lib/db/types.ts (regen, +58 additive)
Behavior implemented: forecast_backtests + forecasts tables per rulings (kind/unit/model checks, shape check pinning kind/series_key/class_section_id/unit, composite FK forecasts->forecast_backtests on delete cascade, bounds + pct-cap checks, set_updated_at). Same SELECT policy both tables: finance_roles() for fees, owner/principal/admin/exam_controller + taught-section teachers for attendance. No write policy (service-role-only writes).
Tests run: pnpm db:reset (clean, 0094 applied, seed ok) -> pnpm test:db tests/db/forecasts-rls.test.ts: 10/10 pass. pnpm test:security: 19 files, 2209/2209 pass (C-01 generated suite covers new tables via rls-expectations entries). pnpm lint: clean. pnpm typecheck: clean.
Tests not run and why: none skipped; full test:db not run (not in ACCEPT list, other agents' concurrent fixtures in tree).
Limitations / honesty label: no label here (limited badge copy is T12/docs).
Security / integration risks: none found; FK/shape/pct-cap checks verified directly (23514/23503); cascade delete verified.
Follow-ups: none new; T3 appends series functions + sweep to same migration file (unmerged).
New dependencies: none.
Assumptions made: table grants as 0069 = none explicit (RLS + default authenticated privileges only, matching 0069's own pattern). PolicyClass tags ["C","T"] (finance-config + teacher-scope combo, no existing single letter fits).
