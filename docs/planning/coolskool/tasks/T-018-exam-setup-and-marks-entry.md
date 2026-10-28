# T-018 — Exam setup, marks entry, verification UI

| Field | Value |
|---|---|
| Lane / Day | A / Day 9 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-EXM-01, F-EXM-02, F-EXM-03 |
| Depends on | T-017, T-013 (merged) |
| Migration | — |

## Business outcome
The exam controller creates an exam and its papers; teachers enter marks per paper (with absent flags) and the controller sees exactly what is missing before publishing.

## Current repo state (verify before starting)
- Exam tables/functions exist: `grep -n "exam_verification\|publish_exam_results" supabase/migrations/20261028000009_exams.sql`.
- Seeded sections, subjects, subject assignments, enrolments: `pnpm db:reset` succeeds; `select count(*) from subject_assignments` > 0.
- `defineAction` and nav exist: `ls src/lib/actions/define-action.ts src/lib/nav.ts`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §1`, `§W7` (setup, marks entry, verification only) · `05-data-architecture.md §2.7` · `07 §2` (exam rows) · `08 §4 J-09` · `04-architecture.md §3`.

## Files to inspect first
`src/modules/attendance/actions.ts` (action pattern in this lane) · `src/modules/academics/queries.ts` (sections, subjects, enrolled students) · `src/lib/auth/context.ts` (`membership.staff_id`).

## Expected changes
- `src/modules/exams/schemas.ts` — `CreateExamSchema`, `CreateExamPapersSchema`, `EnterMarksSchema` (marks ≤ max, absent xor marks), `ExamIdSchema`.
- `src/modules/exams/actions.ts` — `createExam`, `createExamPapers` (bulk for selected sections × subjects, defaults max 80/pass 26.4 rounded per settings `pass_percentage`), `openMarksEntry`, `closeMarksEntry`, `reopenMarksEntry` (unpublished only), `enterMarks` (inserts new `marks` versions for changed students only; supersedes previous), `verifyExam` (calls `app.exam_verification`); audit `exam.marks.entered`.
- `src/modules/exams/queries.ts` — `listExams(termId)`, `getExamWithPapers`, `getPaperMarks(paperId)` (current versions joined to enrolments), `getMyPapers(staffId)`.
- `src/modules/exams/components/` — `ExamForm`, `PaperGrid` (sections × subjects picker), `MarksEntryGrid` (client; absent checkbox; dirty tracking), `VerificationPanel`.
- Pages: `src/app/(tenant)/[institution]/exams/page.tsx`, `.../exams/new/page.tsx`, `.../exams/[examId]/page.tsx`, `.../exams/[examId]/papers/[paperId]/page.tsx`.
- `src/lib/nav.ts` — one line for `/exams` (guard `exam.manage` or `exam.marks.enter`).
- Tests: `tests/unit/exams-schemas.test.ts`, `tests/db/exams-actions.test.ts`, `e2e/j09-marks-entry.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/lib/auth/permissions.ts` · `src/modules/academics/**` (read via `queries.ts` only).

## Permissions / nav / migration numbers needed from the lead
Nav line for `/exams`. Permissions `exam.manage`, `exam.marks.enter` already exist.

## Security and data-integrity requirements
- `enterMarks` requires `exam.marks.enter` and, for teachers, a `subject_assignments` row for the paper's section and subject (checked in the action; RLS also enforces).
- Marks are never updated in place; the action only inserts versions and lets the trigger supersede.
- State transitions validated against `06 §W7` diagram; invalid → `invalid_state`.

## Acceptance criteria
1. `examcontroller` creates "Unit Test 2 (demo)" for Term 2 with papers for X-A..X-F × 5 subjects (30 papers) in one action.
2. `teacher.x-a` sees only papers for subjects assigned to them; entering marks for 42 students creates 42 `marks` rows (v1); changing 3 marks creates 3 v2 rows and supersedes 3 v1 rows.
3. `VerificationPanel` lists missing students after partial entry; after completion `missing` is empty.
4. Marks > max are rejected with `fieldErrors`; absent + marks → `validation_failed`.
5. J-09 passes.

## Tests (write failing tests first) and exact commands
- `tests/unit/exams-schemas.test.ts` · `tests/db/exams-actions.test.ts` (versioning via action, teacher scope) · `e2e/j09-marks-entry.spec.ts`.
- `pnpm test -- tests/unit/exams-schemas.test.ts` · `pnpm test:db -- tests/db/exams-actions.test.ts` · `pnpm test:e2e -- e2e/j09-marks-entry.spec.ts`

## Deliverables
Module files, pages, nav line, tests, completion report.

## Assumptions and risks
- The seeded Half-Yearly exam (T-021, later) is published; this packet's E2E creates its own small exam to avoid dependence on T-021.
- Grid performance for 42 rows is trivial; avoid per-row server calls.

## Completion report
Use the format in `CLAUDE.md`.
