Packet: M20-T5 Migration 0093 part 2 — compute_mastery, sweep, read functions

Files changed:
- `supabase/migrations/20261028000093_mastery.sql` (append part 2) — `public.compute_mastery(p_institution_id)`, `public.enqueue_mastery_compute()`, `public.mastery_heatmap(...)`, `public.mastery_student_stats(...)` per rulings.
- `tests/helpers/mastery-fixture.ts` — added `publishExam`, `gradeSubmission` (service-role inserts).
- `tests/db/mastery-compute-sql.test.ts` (new) — 15 tests, all TEST FIRST cases.
- `tests/security/grants.test.ts` — added `compute_mastery`/`enqueue_mastery_compute` to the service-role-only list.
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4 — new row (enqueue_mastery_compute is a definer; compute_mastery/heatmap/stats explained alongside it).
- `src/lib/db/types.ts` — raw `pnpm db:types` regen.

Behavior implemented: `compute_mastery` — security invoker (only service_role calls it, no escalation needed); mark (w2) + graded-submission (w1) observations, subject always from the unit, class_section from the student's active enrolment; full-institution recompute per call, upsert + delete-stale. `enqueue_mastery_compute` — definer sweep, one job/institution/local-day, `app.module_enabled('mastery')` gated. `mastery_heatmap`/`mastery_student_stats` — invoker, caller's RLS applies.

Tests run: `pnpm db:reset` (clean, 3024 students) → `pnpm test:db tests/db/mastery-compute-sql.test.ts tests/db/mastery-rls.test.ts` 26/26 pass → `pnpm test:security` 3066/3066 pass (incl. updated grants.test.ts) → `pnpm lint` (3 files) clean → `pnpm typecheck` clean.

Tests not run and why: none — all ACCEPT commands ran.

Limitations / honesty label: none new — `limited` badge lands with T15's UI pass.

Security / integration risks: none new. `compute_mastery` is invoker but unreachable by anon/authenticated (no table grant path exploits it — it only writes via its own INSERT/UPDATE, and callers need EXECUTE, revoked). `enqueue_mastery_compute` mirrors `enqueue_due_forecasts` exactly.

Follow-ups: none new. T11 wires `RunnerPorts.enqueueMasteryCompute`/job handler; T6 appends part 3.

New dependencies: none.

Assumptions made: grouped by `(student_id, curriculum_unit_id, subject_id, class_section_id)` instead of aggregating `subject_id`/`class_section_id` with `max()` — Postgres has no built-in `max(uuid)`; the extra group-by columns are functionally determined by the first two, so output is identical. Test institutions get all modules on by default (`tests/helpers/roles.ts allModulesOn()`), so the "mastery off" sweep test explicitly disables it first.
