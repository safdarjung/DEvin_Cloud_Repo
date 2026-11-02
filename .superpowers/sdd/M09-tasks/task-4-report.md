Packet: T-0NN M09-T4 Actions assignment.submit + assignment.grade
Files changed: src/modules/academics/submissions.actions.ts (new); tests/db/submissions-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import); tests/security/escalation.test.ts (+2 C-03 fixtures)
Behavior implemented: submitAssignment (assignment.submit perm) + gradeSubmission (assignment.manage perm) as thin rpc() wrappers over 0071's submit_assignment/grade_submission; mapSqlError, no extra audit (SQL audits).
Tests run: pnpm test:db tests/db/submissions-actions.test.ts -> 6/6 pass. pnpm test tests/unit/action-names-unique.test.ts -> 2/4 pass, 2 fail (pre-existing, other packets' people.leave.*/staffAttendance* not yet wired into all-actions/all-queries; my names not in the diff). pnpm test:security tests/security/escalation.test.ts -> 732/732 pass. pnpm lint -> clean.
Tests not run and why: full test:db / db:reset / db:types per brief (not DB owner).
Limitations / honesty label: none; real feature, no badge.
Security / integration risks: none new. Thin wrappers only; RLS/RPC authz unchanged from T2.
Follow-ups: none from this task.
New dependencies (justification): none.
Assumptions made: generated types.ts marks p_text/p_feedback/p_answers optional (not nullable) — passed via conditional spread, not `?? null`, to satisfy tsc; fixed same shape issue pre-existing in timetable/substitution.actions.ts noted but not touched (not my file).
