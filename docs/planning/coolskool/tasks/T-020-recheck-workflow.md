# T-020 — Recheck request/review/decision workflow

| Field | Value |
|---|---|
| Lane / Day | A / Day 11–12 |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-EXM-06 |
| Depends on | T-019 (merged) |
| Migration | — |

## Business outcome
A guardian questions one paper's marks from the report card; the controller reviews and decides; an approved recheck produces a corrected, versioned result and a notification, with the original preserved and visible to the exam cell.

## Current repo state (verify before starting)
- `app.apply_recheck_decision` exists and is tested (C-42): `grep -n "apply_recheck_decision" supabase/migrations/20261028000009_exams.sql tests/db/exams-schema.test.ts`.
- `ReportCard` and `getResultHistory` exist: `grep -n "getResultHistory\|export default\|export function ReportCard" src/modules/exams/queries.ts src/modules/exams/components/ReportCard.tsx`.
- Published results exist on the demo tenant (T-021) or create one via T-018/T-019 flows in tests.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W8`, `§3` (recheck_decided), `§4` · `05-data-architecture.md §2.7` (recheck_*), `§4.1` (`exams.recheck_window_days`) · `07 §2` (exam.recheck.*) · `08 §3 C-42, C-44`, `§4 J-11, J-12`.

## Files to inspect first
`src/modules/exams/actions.ts` · `src/modules/exams/components/ReportCard.tsx` · `src/lib/auth/context.ts` (`membership.guardian_id`, `student_id`).

## Expected changes
- `src/modules/exams/schemas.ts` — `RequestRecheckSchema` (`resultId`, `examPaperId`, `reason` 10–1000 chars), `RecheckIdSchema`, `DecideRecheckSchema` (`decision`, `newMarks?`, `note`; approve ⇒ `newMarks` required, refined).
- `src/modules/exams/actions.ts` — `requestRecheck` (permission `exam.recheck.request`; window check against `results.published_at + recheck_window_days`; one open request per paper → `conflict`; audit `exam.recheck.requested`), `startRecheckReview` (`exam.recheck.review`), `decideRecheck` (`exam.recheck.decide` → `app.apply_recheck_decision`).
- `src/modules/exams/queries.ts` — `listRecheckQueue(status?)`, `getRecheck(requestId)`, `listRechecksForResult(resultId)`.
- `src/modules/exams/components/` — `RecheckRequestForm` (client, per paper row on `ReportCard` for guardians/students), `RecheckQueue`, `RecheckDecisionForm`, `ResultVersionHistory` (exam roles only).
- Pages: `.../exams/rechecks/page.tsx`, `.../exams/rechecks/[requestId]/page.tsx`; `ReportCard` gains a "Request recheck" affordance and the status of open requests.
- `src/lib/nav.ts` — one line for `/exams/rechecks` (guard `exam.recheck.review`).
- Tests: `tests/unit/recheck-state.test.ts`, `tests/db/recheck-actions.test.ts`, `e2e/j11-recheck-request.spec.ts`, `e2e/j12-recheck-decision.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/modules/notifications/**` · `src/modules/jobs/**` · `src/lib/auth/permissions.ts`.

## Permissions / nav / migration numbers needed from the lead
Nav line for the recheck queue. Permissions exist.

## Security and data-integrity requirements
- `requestRecheck` verifies the result belongs to one of `ctx` guardian's children (or self for a student) in the action; RLS enforces the same (C-44).
- Decisions only through `app.apply_recheck_decision`; the action never touches `marks`/`results` directly.
- Guardian never sees version history or the controller's note beyond the decision text.

## Acceptance criteria
1. `guardian.one` requests a recheck for one paper with a reason; a second request on the same paper → `conflict`; a request after the window → `invalid_state`.
2. A request for another guardian's result → `not_found` (action) and policy error (direct insert).
3. Controller moves the request to `under_review`, approves with new marks: report card shows the new marks, grade, "Corrected on …"; `ResultVersionHistory` lists v1 and v2; guardian has a `recheck_decided` notification (once T-038 is merged).
4. Reject path leaves marks and results unchanged and records the decision.
5. `tests/unit/recheck-state.test.ts` covers every allowed and forbidden transition in `06 §W8`.
6. J-11 and J-12 pass.

## Tests (write failing tests first) and exact commands
- `pnpm test -- tests/unit/recheck-state.test.ts` · `pnpm test:db -- tests/db/recheck-actions.test.ts` · `pnpm test:e2e -- e2e/j11-recheck-request.spec.ts e2e/j12-recheck-decision.spec.ts`

## Deliverables
Schemas, actions, queries, components, pages, nav line, tests, completion report.

## Assumptions and risks
- Students with portal login use the same form; no separate student UI (F-STU-11 limited).
- Fallback ladder step 4 (`09 §7`): if slipping past Day 12, ship controller-entered requests only and label limited.

## Completion report
Use the format in `CLAUDE.md`.
