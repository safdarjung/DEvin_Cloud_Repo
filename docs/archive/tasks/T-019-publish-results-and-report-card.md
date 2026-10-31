# T-019 — Publish results, report card, results notifications

| Field | Value |
|---|---|
| Lane / Day | A / Day 10 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-EXM-04, F-EXM-05 |
| Depends on | T-018 (merged) |
| Migration | — |

## Business outcome
The controller publishes an exam with one click once verification is clean; every guardian sees a clear report card with marks and grades; results are a frozen snapshot that later corrections annotate rather than overwrite.

## Current repo state (verify before starting)
- `app.publish_exam_results` exists and is tested: `grep -n "publish_exam_results" supabase/migrations/20261028000009_exams.sql tests/db/exams-schema.test.ts`.
- Exam pages and `VerificationPanel` exist: `ls src/modules/exams/components/VerificationPanel.tsx`.
- Snapshot JSON shape documented: `grep -n "snapshot" supabase/migrations/20261028000009_exams.sql | head -5`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W7` (publish), `§3` (results_published) · `05-data-architecture.md §2.7` (results), `§4.1` (exams.grading_scales) · `07 §2` (exam.result.*) · `08 §4 J-10` · `08 §3 C-41`.

## Files to inspect first
`src/modules/exams/actions.ts` · `src/modules/exams/queries.ts` · `src/modules/core/schemas.ts` (`InstitutionSettingsSchema` grading scale type) · `src/modules/attendance/components/StudentAttendanceSummary.tsx` (server component export pattern).

## Expected changes
- `src/modules/exams/actions.ts` — `publishExamResults({ examId })` (permission `exam.result.publish`) calling `app.publish_exam_results`; maps `code:invalid_state`.
- `src/modules/exams/queries.ts` — `getCurrentResult(examId, studentId)`, `listResultsForExam(examId)` (current versions, grade distribution), `listResultsForStudent(studentId)`, `getResultHistory(examId, studentId)` (all versions, exam roles).
- `src/modules/exams/components/ReportCard.tsx` — server component (exported for portal and student profile): header, per-subject rows (marks, max, grade), total, percentage, grade, attendance %, "Corrected on <date>" note when `version_no > 1`, print styles.
- `src/modules/exams/components/PublishButton.tsx` — disabled until verification clean; confirm dialog states "cannot be undone; corrections only via recheck".
- `src/modules/exams/components/ResultsTable.tsx` — controller/teacher list with grade distribution summary (also used by T-039).
- Pages: `.../exams/[examId]/results/page.tsx`, `.../exams/[examId]/results/[studentId]/page.tsx`.
- Tests: `tests/unit/grade-for.test.ts` (TS mirror of `app.grade_for` boundaries), `tests/db/exams-publish.test.ts`, `e2e/j10-publish-results.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/modules/notifications/**` · `src/modules/jobs/**` (handler `notify.results_published` is owned by T-038; this packet only relies on the function's enqueue).

## Permissions / nav / migration numbers needed from the lead
None.

## Security and data-integrity requirements
- Guardian/student read of results only via RLS own-scope; `getCurrentResult` never takes `institution_id` from the client.
- Report card shows the current version only to guardians; version history only to `app.exam_roles()`.
- The grade label in the UI must equal `results.grade` from the snapshot (no recomputation on read).

## Acceptance criteria
1. Publishing with clean verification sets `exams.status = 'published'`, creates one `results` row per enrolled student, and queues one `notify.results_published` job per result (C-41 at action level).
2. Publish button is disabled while verification lists missing students; a direct action call in that state returns `invalid_state`.
3. `guardian.one` sees report cards for both children only; a URL with another student's id returns `not_found`.
4. `tests/unit/grade-for.test.ts` passes boundaries 32.99 → E1, 33 → D, 40 → D, 41 → C2, 90.99 → A2, 91 → A1, 100 → A1.
5. J-10 passes (after T-021 seeds the Half-Yearly, the same page shows seeded report cards without change).

## Tests (write failing tests first) and exact commands
- `pnpm test -- tests/unit/grade-for.test.ts` · `pnpm test:db -- tests/db/exams-publish.test.ts` · `pnpm test:e2e -- e2e/j10-publish-results.spec.ts`

## Deliverables
Action, queries, `ReportCard`, `ResultsTable`, pages, tests, completion report.

## Assumptions and risks
- Rank is off by default (`05 §4.1` has no rank setting); do not compute it.
- Print view is CSS-only (`@media print`); no PDF generation.

## Completion report
Use the format in `CLAUDE.md`.
