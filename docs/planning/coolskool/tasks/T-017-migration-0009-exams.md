# T-017 — Migration 0009: exams tables, versioning, publish/recheck functions

| Field | Value |
|---|---|
| Lane / Day | A / Day 8 |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-EXM-01..F-EXM-06 |
| Depends on | T-011 (merged) |
| Migration | `supabase/migrations/20261028000009_exams.sql` |

## Business outcome
Marks are versioned and never overwritten, results are immutable snapshots, rechecks produce traceable corrections, and all of it is enforced in the database so no UI bug can tamper with a result.

## Current repo state (verify before starting)
- Migrations 0001–0008 merged: `ls supabase/migrations/ | grep -c 2026102800` → 8 (0006/0007/0008 may land the same day; coordinate on the number only).
- Helpers: `grep -n "grade_for\|exam_roles\|audit(\|enqueue_job\|block_mutation" supabase/migrations/20261028000001_foundation.sql supabase/migrations/20261028000003_platform.sql`.
- `terms`, `class_sections`, `subjects`, `enrolments`, `attendance_records` exist (`grep -n "create table public\." supabase/migrations/2026102800000[2-6]_*.sql`).

## Spec sections to read (only these)
`05-data-architecture.md §2.7`, `§4.1` (exams block), `§5`, `§6` · `06-workflows-and-contracts.md §W7`, `§W8`, `§4` · `07-security-and-ai-governance.md §2` (exam rows), `§4` · `08-testing-and-acceptance.md §3 C-40..C-44`.

## Files to inspect first
`supabase/migrations/20261028000001_foundation.sql` (`app.grade_for`, `app.audit`, trigger helpers) · `supabase/migrations/20261028000008_finance.sql` (security definer function style: `set search_path = ''`, `code:` errors, `for update`) · `tests/helpers/roles.ts`.

## Expected changes
- `supabase/migrations/20261028000009_exams.sql`:
  - tables `exams`, `exam_papers`, `marks`, `results`, `recheck_requests`, `recheck_decisions`, `answer_sheets` exactly as `05 §2.7` (constraints, partial uniques, indexes).
  - trigger `app.marks_guard()`: BEFORE INSERT checks `0 ≤ marks_obtained ≤ exam_papers.max_marks` or `is_absent`; BEFORE UPDATE allows only `superseded_by` to change from null to a value once; DELETE blocked. Same `superseded_by`-only rule for `results`.
  - revision audit triggers on `marks` and `results` (insert `audit_events` with after image).
  - `app.exam_verification(exam_id) returns jsonb` → `{ missing: [...], outOfRange: [...], summary }` over enrolled students of the exam's sections.
  - `app.publish_exam_results(exam_id)` security definer: caller must have `app.exam_roles()`; status must be `verification`; verification must pass (`code:invalid_state`); builds snapshot per student (per paper marks/max/pass/grade via `app.grade_for(institution_id, exams.grading_scale_key, pct)`, total, max_total, percentage, grade, term attendance %); inserts `results` v1; sets `published`, `published_at`; `app.audit('exam.published')`; `app.enqueue_job('notify.results_published', ..., 'result:<id>')` per result.
  - `app.apply_recheck_decision(request_id, decision, new_marks, note)` security definer: caller in `app.exam_roles()`; request must be `under_review`; approve requires `new_marks` (`code:validation_failed`); inserts decision, marks v+1 (`source = 'recheck'`), supersedes current marks, recomputes that student's result → results v+1, supersedes, request `applied`; reject → `rejected`; audits and enqueues `notify.recheck_decided`.
  - RLS: `exams`, `exam_papers` class S; `marks` SELECT for `app.exam_roles()` or teacher with a `subject_assignments` row for that paper's section+subject, INSERT same set; `results` SELECT class S+G own-scope; `recheck_requests` SELECT/INSERT own rows for guardian/student (result must belong to `app.guardian_student_ids` / `app.own_student_id`) plus exam roles; `recheck_decisions` exam roles; `answer_sheets` exam roles only. Execute on the two functions granted to `authenticated` only.
- `src/lib/db/types.ts` regenerated · `tests/security/rls-expectations.ts` entries · `tests/db/exams-schema.test.ts`.

## Must not modify
Migrations 0001–0008 · `src/modules/**` · `scripts/seed/**`.

## Permissions / nav / migration numbers needed from the lead
None (0009 reserved).

## Security and data-integrity requirements
- No guardian policy on `marks`; pre-publication confidentiality holds because `results` rows do not exist until publish.
- Publishing twice raises `code:invalid_state`; a published exam can never return to `marks_entry`.
- Every state change writes `audit_events`; functions use `for update` on the exam/request row.

## Acceptance criteria
1. C-43: UPDATE of `marks_obtained` raises; second current version for the same (paper, student) violates the partial unique; marks > max rejected.
2. C-40: `app.publish_exam_results` on an exam with one student lacking a current mark raises `code:invalid_state` and inserts no results.
3. C-41: with complete marks, exactly one `results` row per enrolled student; `total = Σ current marks`; second call raises.
4. C-42: `apply_recheck_decision(approve, 78)` creates marks v2 and results v2, v1 rows unchanged with `superseded_by` set, request `applied`, two audit rows, one job.
5. C-44 at RLS level: guardian cannot insert a `recheck_requests` row for another guardian's result.
6. Generated suite green with the new expectations.

## Tests (write failing tests first) and exact commands
- `tests/db/exams-schema.test.ts` (C-40..C-44 against the SQL functions with per-role clients).
- `pnpm test:db -- tests/db/exams-schema.test.ts` · `pnpm test:security`

## Deliverables
Migration, types, expectations, tests, completion report listing the two security definer functions for `07 §4`.

## Assumptions and risks
- Attendance % in the snapshot uses `attendance_records` for the exam's term; if attendance seed is absent in a test, the value is 0 and allowed.
- Snapshot JSON shape is owned here and consumed by T-019's `ReportCard`; document it in the migration header comment.

## Completion report
Use the format in `CLAUDE.md`.
