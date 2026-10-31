# T-010 — Migration 0004: people + RLS (S+G)

| Field | Value |
|---|---|
| Lane / Day | B / Day 4 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-STU-01, F-STU-02, F-STU-03 |
| Depends on | T-004 (merged) |
| Migration | `supabase/migrations/20261028000004_people.sql` |

## Business outcome
Students, guardians, their links, departments, and staff exist once, owned by `people`, with guardian scope enforced in the database so a parent can only ever see their own children.

## Current repo state (verify before starting)
- 0001–0003 applied: `ls supabase/migrations/ | wc -l` → 3.
- Helpers `app.guardian_student_ids`, `app.own_student_id`, `app.staff_id` exist: `psql "$SUPABASE_DB_URL" -c "\df app.*" | grep -c guardian_student_ids` → 1.

## Spec sections to read (only these)
- `05-data-architecture.md §2.2` (all five tables), `§5` (class S+G), `§6` (operational semantics).
- `07-security-and-ai-governance.md §2` rows student.*, guardian.read, staff.*; §6 C-10, C-11.
- `12-decision-log.md` D4, D15.

## Files to inspect first
- 0001 helper bodies for `guardian_student_ids` / `own_student_id` / `staff_id` (confirm they reference the column names you create); `tests/security/rls-expectations.ts`.

## Expected changes
- `20261028000004_people.sql`: `departments`, `staff`, `students`, `guardians`, `guardian_students` per `05 §2.2` (uniques: `(institution_id, admission_no)`, `(institution_id, employee_no)`, `(institution_id, phone)` on guardians, `source_application_id` unique, one primary guardian per student partial unique; indexes on `user_id`, `(institution_id, status)`); `updated_at` triggers.
- RLS: `students` — SELECT `app.has_role(institution_id, app.staff_roles())` OR `id in (select app.guardian_student_ids(institution_id))` OR `id = app.own_student_id(institution_id)`; INSERT/UPDATE by owner/principal/admin/admissions; no DELETE. `guardians` — SELECT staff roles minus exam_controller/teacher per `07 §2` (teacher scoped: guardians of students in sections they teach via `app.teaches_section` join) OR own row (`user_id = app.current_user_id()`); writes owner/principal/admin/admissions. `guardian_students` — SELECT as for students plus own guardian rows; writes admissions roles. `staff` — SELECT owner/principal/admin/accountant/exam_controller + own row; writes owner/principal/admin. `departments` — class S.
- Add expectation rows for the five tables to `tests/security/rls-expectations.ts`.
- Regenerate types.

## Must not modify
- 0001–0003; `src/` beyond types and expectations.

## Permissions / nav / migration numbers needed from the lead
- Migration number 0004 reserved here.

## Security and data-integrity requirements
- Guardian/student policies must not rely on client-supplied ids (helpers derive from `auth.uid()`).
- `students.user_id`/`guardians.user_id` unique per institution (partial unique where not null).
- Phone stored normalised to 10 digits (check constraint `^[6-9][0-9]{9}$`).

## Acceptance criteria
1. `pnpm db:reset` green; types regenerated; generated security suite passes with the new expectation rows (C-01 for five tables).
2. C-10: a guardian of institution A querying a student id from institution B gets 0 rows; a teacher of A gets 0 rows for B.
3. C-11: guardian G1 sees exactly their linked students; G2's child id returns 0 rows for G1.
4. Student user sees only own `students` row.
5. Second primary guardian for the same student fails; duplicate guardian phone fails; duplicate `source_application_id` fails.

## Tests (write failing tests first) and exact commands
- `tests/db/people.test.ts` — C-10, C-11, criteria 4–5.
- Commands: `pnpm test:db -- tests/db/people.test.ts`, `pnpm test:security`.

## Deliverables
- Migration 0004, types, expectation rows, tests, completion report.

## Assumptions and risks
- Teacher visibility of guardians requires `class_sections`/`enrolments` (0005). Write the teacher policy clause now; it evaluates to false until 0005 lands; T-011 adds the test.
- `details jsonb` holds optional fields (category, blood group) — no schema validation in DB.

## Completion report
Use the format in `CLAUDE.md`.
