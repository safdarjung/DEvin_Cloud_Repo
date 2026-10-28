# T-011 — Migration 0005: academics + RLS

| Field | Value |
|---|---|
| Lane / Day | A / Day 4 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-ACA-01…05, F-STU-04 |
| Depends on | T-010 (merged) |
| Migration | `supabase/migrations/20261028000005_academics.sql` |

## Business outcome
The class ladder, sections with class teachers, subjects, teacher assignments, year-scoped enrolments with history, curriculum units, and assignments exist, enabling attendance, exams, finance, and AI lanes to start.

## Current repo state (verify before starting)
- 0004 applied: `ls supabase/migrations/ | grep -c 0004` → 1.
- `app.teaches_section` exists: `psql "$SUPABASE_DB_URL" -c "\df app.teaches_section"`.

## Spec sections to read (only these)
- `05-data-architecture.md §2.3` (nine tables), `§4.1` (`academic.section_names`, `max_section_size`), `§5` (classes S, S+G, T), `§6`.
- `07-security-and-ai-governance.md §2` rows academics.*, assignment.*; §6 C-13.
- `12-decision-log.md` D4.

## Files to inspect first
- 0004 (`students`, `staff` names), 0001 `teaches_section` body, `tests/security/rls-expectations.ts`.

## Expected changes
- `20261028000005_academics.sql`: `grades`, `class_sections`, `subjects`, `subject_assignments`, `enrolments`, `enrolment_status_history`, `curriculum_units`, `assignments`, `assignment_submissions` per `05 §2.3` with all uniques/partials/indexes.
- Triggers: `enrolments` status change → `enrolment_status_history` row (from/to/changed_by); `class_sections.capacity` default from `settings.academic.max_section_size` on insert when null.
- RLS: `grades`, `subjects`, `curriculum_units`, `subject_assignments`, `class_sections` — class S read (plus guardian/student read of their own section rows); writes owner/principal/admin. `enrolments` — class S+G (guardian/student own via `student_id`); writes owner/principal/admin/admissions. `enrolment_status_history` — read as enrolments; no direct writes (trigger only). `assignments` — SELECT staff roles OR (`status='published'` AND student in section via `app.guardian_student_ids`/`app.own_student_id` ⋈ enrolments); INSERT/UPDATE by owner/principal OR `app.teaches_section(institution_id, class_section_id)`. `assignment_submissions` — own student/guardian read; teacher of section read; writes own student (P1, policy only).
- Expectation rows for nine tables; regenerate types.

## Must not modify
- 0001–0004.

## Permissions / nav / migration numbers needed from the lead
- Migration number 0005 reserved here.

## Security and data-integrity requirements
- `enrolments` unique `(student_id, academic_year_id)`; `(class_section_id, roll_no)` partial unique.
- Teacher writes limited to sections they teach (class T) — verified by C-16-style test here for `assignments`.
- Guardians never see `draft` assignments.

## Acceptance criteria
1. `pnpm db:reset` green; types; security suite green with new rows.
2. C-13: duplicate enrolment per year fails; duplicate roll number per section fails; status change writes history with `changed_by`.
3. Teacher T1 (class teacher of VI-A) can insert an assignment for VI-A and cannot for VI-B; guardian sees published, not draft.
4. `app.teaches_section` true for class teacher and for subject-assigned teacher, false otherwise.
5. Teacher can read guardians of students in their sections (completes T-010 clause) and not others.

## Tests (write failing tests first) and exact commands
- `tests/db/academics.test.ts` — C-13, criteria 3–5.
- Commands: `pnpm test:db -- tests/db/academics.test.ts`, `pnpm test:security`.

## Deliverables
- Migration 0005, types, expectation rows, tests, completion report.

## Assumptions and risks
- Grade ladder is per institution (seed writes I–XII with `sort_key` 1–12); pre-primary rows are config, not seeded.
- `assignments.content jsonb` shape (`QuizSchema`) is validated in TS (T-022/T-036), not in SQL.

## Completion report
Use the format in `CLAUDE.md`.
