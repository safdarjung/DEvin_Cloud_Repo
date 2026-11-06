# M20 security review — findings

Source: milestone review for M20 (mastery). Reviewer is read-only; this file is written by the fix agent before any fix is applied.

## MEDIUM — docs/planning/coolskool/07-security-and-ai-governance.md

T15 ruling requires one sentence each for the two new triggers `app.validate_exam_paper_units` and `app.guard_intervention` in §4, but neither trigger is mentioned anywhere in the doc (only `enqueue_mastery_compute`, `compute_mastery`, `mastery_heatmap`, `mastery_student_stats` are documented). A future reviewer auditing §4 for "every definer/guard with a bypass" will miss these two security-relevant BEFORE triggers (one enforces tenant/subject/grade scoping on `exam_papers.unit_ids`, the other enforces the intervention state machine and the service_role/postgres trust bypass).

Fix: add the two sentences the ruling specifies.

## LOW — supabase/migrations/20261028000093_mastery.sql

`app.validate_exam_paper_units()` resolves `v_grade_id` via `select cs.grade_id from public.class_sections cs where cs.id = new.class_section_id` with no `cs.institution_id = new.institution_id` guard. This is currently safe only because `exam_papers`'s own RLS `with check` (0009/0073) already forces `class_section_id` to belong to the same institution for every authenticated writer, and service-role writers are trusted — but the trigger itself has no defense-in-depth institution check, unlike the `curriculum_units` lookup two lines below which does qualify `cu.institution_id = new.institution_id`. Low risk given the existing invariant, but inconsistent with lesson 2 (bind every user-supplied FK to the same institution in the validating code itself, not only in a sibling table's RLS).

## LOW — src/modules/mastery/actions.ts

`updateIntervention`'s read and update queries filter only by `.eq("id", input.id).eq("kind", "intervention")`, with no explicit `.eq("institution_id", ctx.institution.id)` the way the sibling `exam.paper.setUnits` action does. Correctness today relies entirely on RLS (`insight_actions_intervention_update`/`_select`, scoped to the caller's own institution via `my_institution_ids`/`my_class_teacher_student_ids`), so there is no real cross-tenant leak, but it diverges from the explicit institution-scoping pattern used elsewhere in the same milestone and loses defense-in-depth if a future RLS policy change narrows unexpectedly or is temporarily bypassed in a migration/test harness.

---

## Outcomes

- **MEDIUM (07-security-and-ai-governance.md §4)** — fixed. Added one sentence each for `app.validate_exam_paper_units()` and `app.guard_intervention()` to the M20 §4 row (0093 part 2), plus a note that RLS on intervention rows reuses X07's `app.my_class_teacher_student_ids()` (no new row). Docs-only; no test applicable.

- **LOW (20261028000093_mastery.sql, `app.validate_exam_paper_units`)** — fixed. Added `and cs.institution_id = new.institution_id` to the `class_sections` lookup, matching the `curriculum_units` lookup's existing institution qualifier two lines below. No new test: this is a pure defense-in-depth consistency fix with no reachable behavioral difference — `exam_papers`'s own RLS `with check` already forces `class_section_id` into the same institution for every authenticated writer before the trigger runs, and grade ids are per-institution random UUIDs that cannot coincidentally collide across institutions even via a direct admin-SQL cross-tenant row, so no test (old or new) can observe a different accept/reject outcome. Existing `tests/db/exam-paper-units-actions.test.ts` (5/5 passing) and the full `mastery-*` + `exam-paper-units-actions` DB suite re-run clean after the change; `pnpm db:reset` applied the edited (not-yet-hosted) migration cleanly.

- **LOW (src/modules/mastery/actions.ts, `updateIntervention`)** — fixed. Added `.eq("institution_id", ctx.institution.id)` to both the read and the update query, matching the sibling `exam.paper.setUnits` action's explicit-scoping pattern. No new test: behavior is unchanged under RLS (`insight_actions_intervention_select`/`_update` already scope to the caller's institution/class-teacher-student set), so this is defense-in-depth only, not a new branch or state transition. `tests/db/mastery-intervention-actions.test.ts` (6/6 passing) re-run clean after the change.

### Tests re-run after fixes (all pass)
- `pnpm test:db tests/db/exam-paper-units-actions.test.ts tests/db/mastery-intervention-actions.test.ts tests/db/mastery-interventions-rls.test.ts tests/db/mastery-rls.test.ts tests/db/mastery-compute-sql.test.ts` → 5 files, 50 tests
- `pnpm test:db tests/db/mastery-acceptance.test.ts tests/db/mastery-detector.test.ts tests/db/mastery-queries.test.ts tests/db/mastery-success-queries.test.ts tests/db/seed-mastery.test.ts tests/db/api-query-route.test.ts` → 6 files, 33 tests
- `pnpm test:security` → 19 files, 3098 tests
- `pnpm test tests/unit/mastery-rules.test.ts tests/unit/permissions.test.ts tests/unit/action-names-unique.test.ts` → 3 files, 68 tests
- `pnpm exec tsc --noEmit -p tsconfig.json` → no errors in touched files
- `pnpm db:reset` → applied edited 0093 migration + reseeded, clean

No regressions. `supabase/migrations/20261028000093_mastery.sql` is not hosted (confirmed against BRIEF-COMMON's HOSTED-APPLIED list), edited in place.
