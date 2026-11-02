Packet: M10-T1 Migration 0072 — lesson_plans, curriculum_unit_coverage, RLS, guards
Files changed: supabase/migrations/20261028000072_curriculum_coverage.sql (new); tests/db/curriculum-rls.test.ts (new); src/lib/db/types.ts (regen); tests/security/rls-expectations.ts (2 entries appended)
Behavior implemented: lesson_plans + curriculum_unit_coverage tables, indexes, FK-bound RLS (write scope = 0026 assignments rule verbatim; lesson_plans SELECT owner/principal/admin+teacher scope; coverage SELECT staff_roles()+own section), guard_lesson_plan_identity / guard_coverage_identity invoker triggers freezing institution_id/class_section_id(+created_by/curriculum_unit_id). No new helper functions — reused 0020/0026 initPlan helpers. No security definer functions added.
Tests run: pnpm db:reset (supabase CLI, direct, 72 migrations clean) → ok; pnpm db:types → ok (stripped 2 non-TS header lines + 1 CLI update-nag line the CLI piped into stdout); pnpm test:db tests/db/curriculum-rls.test.ts → 9/9 pass; pnpm test:security → 18 files, 1486/1486 pass; pnpm lint → clean; pnpm typecheck → clean
Tests not run and why: pnpm demo:reset — not required by this task's ACCEPT list (seed/0072 wiring is T5)
Limitations / honesty label: none (real data, no AI, no channel)
Security / integration risks: none found; FK bindings table-qualified per lesson 2, guards bypass only service_role/postgres per lesson 5
Follow-ups: none new (debt rows are T7's)
New dependencies (justification): none
Assumptions made: ran `node_modules/.bin/supabase` directly (not `npx`, which is blocked) since it's already vendored; local stack was already running on the project's own ports (54321-54329)
