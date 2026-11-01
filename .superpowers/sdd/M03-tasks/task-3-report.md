Packet: M03-T3 Migration 0065 — bind setup-table FKs to the institution

Files changed:
- supabase/migrations/20261028000065_setup_fk_binding.sql (new)
- tests/db/setup-fk-binding.test.ts (new)

Behavior implemented:
Dropped + recreated terms_insert/update, class_sections_insert/update, staff_insert/update,
curriculum_units_insert/update. Same role lists as today (owner/principal/admin for all
four tables, unchanged). `with check` now also proves every user-supplied FK belongs to
the row's own institution_id:
- terms.academic_year_id -> academic_years (exists, table-qualified)
- class_sections.grade_id, .academic_year_id -> grades/academic_years (exists)
- class_sections.class_teacher_id (nullable) -> app.staff_in_institution(...) when not null,
  mirroring 0036's style for the teacher_id FK on subject_assignments
- staff.department_id (nullable) -> departments (exists) when not null
- curriculum_units.subject_id, .grade_id -> subjects/grades (exists) — brief's EXPORTS line
  says "subject_id (+ any other FK on it)"; curriculum_units has one other FK, grade_id
  (also not null), so bound it too.
Mirrors supabase/migrations/20261028000036_enrolment_subject_assignment_fks.sql exactly:
same shape (drop/create, role list untouched, table-qualified columns in subqueries).

Tests run:
- RED (before migration applied): `pnpm test:db tests/db/setup-fk-binding.test.ts` ->
  4 failed / 1 passed (the 4 cross-tenant "cannot" cases incorrectly succeeded; the
  same-institution "valid" case already passed under the old policies).
- Applied: `pnpm exec supabase migration up --local --include-all` -> applied cleanly,
  0065 now shows a remote timestamp in `migration list --local`.
- GREEN: `pnpm test:db tests/db/setup-fk-binding.test.ts` -> 5 passed / 5 (actual).
- `pnpm test:security` -> 18 files, 1107 passed / 1107 (actual, no regressions).
- `pnpm lint` -> clean (0 errors, 0 warnings; fixed one unused-import warning I introduced,
  then re-ran the db test file to confirm still green).
- `pnpm typecheck` -> clean.
- `pnpm db:types` -> ran; diff against the previous committed `src/lib/db/types.ts` is empty
  (no RPCs added/changed by this packet), so nothing to commit there.

Tests not run and why: none skipped — all ACCEPT commands from the brief ran.

Limitations / honesty label: none; this is a pure RLS-policy fix, no UI/label surface.

Security / integration risks: none identified. The FK-existence subqueries run under the
caller's own RLS on departments/grades/academic_years/subjects/staff — for a legitimate
same-institution row this always succeeds (caller already holds owner/principal/admin in
that institution, which is a superset of each referenced table's SELECT policy); for a
cross-tenant row the referenced row in the *other* institution is invisible to the caller
under that table's own RLS, so `exists` is false either way — same end result as an
explicit institution_id equality check, consistent with 0036's precedent.

Follow-ups: none.

New dependencies (justification): none.

Assumptions made:
- Brief's TEST FIRST list enumerates exactly 4 "cannot" cases (section->grade, term->year,
  staff->department, class_teacher->staff) + 1 "valid" case; it does not list a dedicated
  cross-tenant case for curriculum_units.subject_id/grade_id even though EXPORTS requires
  binding them. Implemented the binding (required by EXPORTS + lesson 2) but did not invent
  an extra negative test beyond the brief's list — the "valid" test does exercise
  curriculum_units with real same-institution FKs so the new check is proven not to break
  legitimate writes; it just isn't proven to reject a cross-tenant curriculum_units write in
  a dedicated test. Flagging this gap rather than silently expanding scope.
- Used `app.staff_in_institution` (existing granted-to-authenticated definer) for
  class_teacher_id, matching 0036's exact treatment of subject_assignments.teacher_id,
  rather than a plain `exists` on staff (both would behave identically here since
  owner/principal/admin already have staff SELECT).
