# X01-T6 Student leave actions — completion report

Packet: X01-T6 Student leave actions
Files changed:
- `src/modules/student-leave/actions.ts` (new) — `studentLeave.request/approve/reject/cancel`
- `tests/db/student-leave-actions.test.ts` (new)
- `src/app/api/v1/actions/all-actions.ts` (+1 import line)
- `tests/security/escalation.test.ts` (+4 C-03 fixtures)

Behavior implemented: `studentLeave.request` inserts with ctx institution_id; guard overwrites `class_section_id`/`created_by`; 42501 -> forbidden; returns `{id, status}`; audits `student_leave.requested`. `approve`/`reject`/`cancel` call `decide_student_leave` RPC, map `code:*` errors, return `{id, status}`.

Tests run: `pnpm test:db tests/db/student-leave-actions.test.ts` -> 8/8 passed. `pnpm test:security tests/security/escalation.test.ts` -> 1131/1132 passed (1 pre-existing failure, not mine, see below). `pnpm lint` clean. `pnpm typecheck` clean.

Tests not run and why: `pnpm test tests/unit/action-names-unique.test.ts` fails (1/6) — same pre-existing cause as below, not run again after confirming root cause.

Limitations / honesty label: none; no UI, no badge applicable.

Security / integration risks: none from this diff. Pre-existing failures from concurrent X08/X01-T8 lane work mid-flight in this shared tree: `action-names-unique.test.ts` and `escalation.test.ts`'s registry-count check fail because `src/modules/ptm/survey.actions.ts` (3 `defineAction` calls) isn't yet imported into `all-actions.ts` by its own task. My `studentLeave.*` entries are correctly present in both files' diffs — confirmed by diffing expected vs received sets.

Follow-ups: none for T6. T7 (queries) and T11 (acceptance) build on this.

New dependencies: none.

Assumptions made: `class_section_id`/`created_by` passed as placeholder values on insert (guard always overwrites both) to satisfy the generated Insert type's required columns, matching the RLS test fixtures' spoofed-value pattern.
