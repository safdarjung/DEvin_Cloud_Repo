# T-021 — Seed exams (published half-yearly, rechecks)

| Field | Value |
|---|---|
| Lane / Day | A / Day 12 |
| Size | 1 agent-day |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-EXM-02, F-EXM-04, F-EXM-06, F-IDN-06 |
| Depends on | T-017, T-013 (merged) |
| Migration | — |

## Business outcome
Every guardian in the demo has a published Half-Yearly report card to look at, the principal dashboard has a grade distribution, and the recheck queue already shows realistic activity.

## Current repo state (verify before starting)
- Seed sections `core`, `people`, `academics` registered: `grep -n "sections" scripts/seed/index.ts`.
- `app.publish_exam_results` and `app.apply_recheck_decision` exist: `grep -n "create or replace function app.publish_exam_results\|app.apply_recheck_decision" supabase/migrations/20261028000009_exams.sql`.
- `SeedContext` exposes terms, sections, subject assignments, enrolments: `grep -n "terms\|subjectAssignments\|enrolments" scripts/seed/context.ts`.

## Spec sections to read (only these)
`05-data-architecture.md §8` · `05 §2.7` · `06-workflows-and-contracts.md §W7` (publish), `§W8` · `12-decision-log.md D19`.

## Files to inspect first
`scripts/seed/sections/attendance.ts` (bulk and idempotency patterns) · `scripts/seed/index.ts` · `supabase/migrations/20261028000009_exams.sql` (function signatures, snapshot shape).

## Expected changes
- `scripts/seed/sections/exams.ts`:
  - exam "Half-Yearly Examination 2026" (`type = 'half_yearly'`, Term 1) with one `exam_papers` row per (section, subject assignment), `max_marks` 80 (scholastic) / 50 (co-scholastic), `pass_marks` from `settings.exams.pass_percentage`, `held_on` 2026-09-14..25.
  - `marks` v1 for every active enrolment: deterministic normal-ish distribution (mean 62, sd 16, clamped 0–80) with 1.5% absent; a handful of deliberately boundary values (33, 40, 91).
  - transition to `marks_entry` → `verification` → call `app.publish_exam_results(exam_id)` as the seeded exam-controller user (service-role client sets `request.jwt.claims` or calls via a seeded session) so audit and notifications are realistic; jobs created by publish are marked `succeeded` by the seed (notifications seeded directly) to avoid 3,024 pending jobs.
  - two `recheck_requests` from `guardian.one`: one `under_review`; one approved via `app.apply_recheck_decision` with `new_marks` +4 so J-12 has a precedent and `ResultVersionHistory` shows two versions.
- `scripts/seed/index.ts` — register after `attendance`.
- `tests/db/seed-exams.test.ts` — counts and invariants.

## Must not modify
`supabase/migrations/**` · `src/**` · other seed sections.

## Permissions / nav / migration numbers needed from the lead
None.

## Security and data-integrity requirements
- Marks and results are created through the same triggers as production (no trigger disabling).
- Publication uses `app.publish_exam_results`, not direct inserts into `results`, so snapshot logic has one home.
- Rerun idempotent: skip if the exam already exists with `status = 'published'`.

## Acceptance criteria
1. `exams` has one published Half-Yearly; `exam_papers` count = Σ subject assignments across 72 sections; `marks` current rows = enrolments × subjects per section.
2. `results` current rows = 3,024; Σ(`total`) equals Σ current marks (C-41 invariant re-asserted on seed data).
3. Grade distribution has every grade A1..E2 represented; absent students have `is_absent = true` and zero marks in the snapshot.
4. One `recheck_requests` row `under_review`, one `applied` with marks v2 and results v2 for that student.
5. `pnpm db:reset` completes; time recorded in the completion report.

## Demo-data contract (from `05 §8.1`, mandatory)
- `HY-2026` (`half_yearly`, Term 1): papers for all 72 sections, every student marked, published 2026-10-05 via `app.publish_exam_results`; recheck requests: Ishaan Mehta Science `applied` (61 → 64, marks v2 + result v2 present), one X-D student English `under_review`.
- `PT2-X` (`unit_test`, Term 2, "Periodic Test 2 (Grade X)"): papers for X-A…X-F × subjects with max 40 / pass 13; status `marks_entry`; all marks entered except X-A Mathematics (42 students unmarked) so the demo enters, verifies, and publishes live; expected results after publish: 252.

## Tests (write failing tests first) and exact commands
- `pnpm test:db -- tests/db/seed-exams.test.ts` · `time pnpm db:reset`

## Deliverables
Seed section, index registration, test, completion report with timings.

## Assumptions and risks
- Co-scholastic subjects are seeded by T-013 with `kind = 'co_scholastic'`; if absent, all papers use 80.
- Publishing 3,024 snapshots inside one function call must stay under ~30 s locally; if not, record it and split by grade in the seed (function unchanged).

## Completion report
Use the format in `CLAUDE.md`.
