Packet: M19-T2 Migration 0092 part 1 — tables, RLS, record_insights
Files changed: supabase/migrations/20261028000092_insights.sql (new), tests/db/insights-rls.test.ts (new), tests/security/rls-expectations.ts (+insights/insight_actions/briefings), src/lib/db/types.ts (regen, additions only)
Behavior implemented: insights/insight_actions/briefings tables, checks, indexes, RLS (SELECT only — no insert/update/delete policy on any of the 3); public.record_insights(institution_id, rows) plpgsql invoker, service_role-only, on-conflict-do-nothing writer with cross-tenant class_section_id guard.
Tests run: pnpm db:reset (clean); pnpm test:db tests/db/insights-rls.test.ts → 12/12 passed; pnpm test:security → 19 files, 2223/2223 passed; pnpm lint clean; pnpm typecheck clean.
Tests not run and why: none skipped — all ACCEPT commands run green.
Limitations / honesty label: n/a (no UI, no AI boundary in this part).
Security / integration risks: insight_actions SELECT relies on an exists() subquery over public.insights honoring the caller's own RLS (confirmed by test, not just inference) — any future change to insights RLS must keep this inheritance in mind. record_insights is invoker (per spec) relying on service_role's table grants + BYPASSRLS, not SECURITY DEFINER.
Follow-ups: T3 adds review helpers/decide_insight/record_insight_action/set_insight_explanation (definers) appending to the same migration file.
New dependencies: none.
Assumptions made: entity_label null-check written as `entity_type not in ('student','staff') or entity_label is null` (NULL-safe: passes when entity_type is null). insights_dedupe_key/insights_open_key/insight_actions_one_successor_idx names taken literally from the ruling text.
