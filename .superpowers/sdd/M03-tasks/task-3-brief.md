### Task 3: M03-T3 Migration 0065 — bind setup-table FKs to the institution
READ: BRIEF-COMMON.md lesson 2; `…0036*` (the enrolments/subject_assignments precedent — mirror its style); write policies in 0002/0004/0005
FILES: `supabase/migrations/20261028000065_setup_fk_binding.sql` (new); `tests/db/setup-fk-binding.test.ts` (new)
EXPORTS: drop + recreate INSERT/UPDATE policies (same role list) with `with check` also proving every FK belongs to the row's institution: `terms.academic_year_id`; `class_sections.grade_id`, `.academic_year_id`, `.class_teacher_id` (when not null); `staff.department_id` (when not null); `curriculum_units.subject_id` (+ any other FK on it). Table-qualified columns in subqueries.
TEST FIRST: "admin of A cannot create a section in A pointing at B's grade"; same for term→B's year, staff→B's department, class_teacher→B's staff; "valid same-institution insert still works".
ACCEPT: `pnpm test:db tests/db/setup-fk-binding.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`

