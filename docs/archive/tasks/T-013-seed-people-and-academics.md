# T-013 — Seed people + academics (3,024 students, 72 sections, 106 staff)

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 6 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-STU-01…04, F-ACA-01…04, F-IDN-06 |
| Depends on | T-012 (merged) |
| Migration | — |

## Business outcome
The demo school looks real: twelve grades with six sections each, class teachers, subjects, roll numbers, guardians with one or two children, and curriculum units ready for AI quizzes — the data every lane builds on.

## Current repo state (verify before starting)
- Core seed runs: `pnpm seed` succeeds; `scripts/seed/sections/people.ts` and `academics.ts` are stubs: `grep -c TODO scripts/seed/sections/people.ts`.
- Tables exist: `grep -c 'curriculum_units' src/lib/db/types.ts` > 0.

## Spec sections to read (only these)
- `05-data-architecture.md §8` (counts, demo logins' linked rows, batching), `§2.2–2.3` (columns), `§4.1` (`academic.*`, `numbering.*`).
- `11-operations.md §3` (which demo users are class teachers/guardians/student).
- `12-decision-log.md §2` row "Domain" (subject sets by grade group, designations).

## Files to inspect first
- `scripts/seed/lib/*` (PRNG, ids, batch, context API), `scripts/seed/sections/core.ts` (how ctx is populated), `app.next_sequence` signature in 0001.

## Expected changes
- `scripts/seed/sections/people.ts` — `departments` (Primary, Middle, Secondary, Senior Secondary, Accounts, Admissions, Exam Cell, Admin); `staff`: 100 teaching (designations PRT/TGT/PGT by wing) + 6 office (principal, admin, admissions, accountant, exam controller, clerk) with `employee_no` via `app.next_sequence`; link demo users to their staff rows; `students` 3,024 (42 per section) with `admission_no` from the sequence, DOB by grade, gender mix, synthetic names; `guardians` ≈2,400 unique phones, 1–2 children each (siblings share surname); `guardian_students` with one primary; demo `guardian.one` → two children in different grades, `guardian.two` → one child, `student.one` → a student in X-A with `user_id`.
- `scripts/seed/sections/academics.ts` — `grades` I–XII (`sort_key`, `grade_group`); `class_sections` A–F per grade for 2026-27 with class teachers (demo teachers → VI-A, VIII-B, X-A); `subjects` per grade group (English, Hindi, Mathematics, EVS/Science, Social Science, Computer, co-scholastic Art/PE; IX–X add Sanskrit/IT; XI–XII streams per section A/B/C); `subject_assignments` so every section×subject has a teacher (round-robin, class teacher gets one subject); `enrolments` active with `roll_no` 1–42 alphabetical; `curriculum_units` 4 per subject per grade with short descriptive text (≈300 tokens max) suitable for quiz generation.
- Count assertions appended to `scripts/seed/index.ts` (students 3,024; sections 72; staff 106; enrolments 3,024; assignments 0).
- `tests/helpers/factories.ts` may gain `seedGradeLadder()` reused by other tests.

## Must not modify
- Migrations; `core.ts` beyond exposing ids via `SeedContext`.

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- All names, phones, emails synthetic; phones start with 9 and never collide with demo users.
- Inserts go through the real triggers/constraints (no `disable trigger`).
- Deterministic: two consecutive `demo:reset` runs produce identical `admission_no` for the same student id.

## Acceptance criteria
1. `pnpm demo:reset` completes with counts: students 3,024, guardians ≥ 2,300, guardian_students ≥ 3,024, staff 106, sections 72, enrolments 3,024, subjects ≥ 12, curriculum_units ≥ 4 × subjects × grades covered.
2. `db:reset` wall time measured and reported; target < 2 min (report actual; if > 3 min, apply `09 §5` mitigation and report).
3. Determinism: hash of `select admission_no, id from students order by 1` identical across two resets.
4. Every section has exactly one class teacher and ≥ 5 subject assignments; every student has exactly one primary guardian.
5. Logged-in `teacher.vi-a` sees VI-A roster via RLS; `guardian.one` sees two children (DB-level checks with `clientAs`).

## Demo-data contract (from `05 §8.1`, mandatory)
- `guardian.one` = Priya Sharma `9800000001` with Aarav Sharma (VI-A, roll 7, `ADM/2024/00412`) and Ananya Sharma (X-A, roll 12, `ADM/2020/00133`); `guardian.two` = Rohit Mehta `9800000002` with Ishaan Mehta (VIII-B, roll 3); `student.one` = Ananya's login.
- `teacher.x-a` is class teacher of X-A and subject teacher of X-A Mathematics; curriculum unit `UNIT-X-MATH-3` "Quadratic Equations" exists for Grade X Mathematics.
- Every section has `capacity = 45` and 42 students; I-C and VI-B keep room for the live enrolments.
- `SEED_SCALE=small` (CI) seeds 2 sections per grade but keeps every named entity.

## Tests (write failing tests first) and exact commands
- `tests/db/seed-people-academics.test.ts` — criteria 1, 3, 4, 5 (runs after `pnpm seed` in `globalSetup` or reads the seeded DB; mark `@slow`).
- Commands: `pnpm demo:reset`, `pnpm test:db -- tests/db/seed-people-academics.test.ts`.

## Deliverables
- Two seed sections, assertions, test, timing in the report.

## Assumptions and risks
- 42 students × 72 sections = 3,024 exactly; sibling pairs reduce distinct guardians to ≈2,400.
- Sequence allocation per row (`next_sequence`) is ~3,100 calls; if slow, allocate in SQL batches via a seed-only function and report.

## Completion report
Use the format in `CLAUDE.md`.
