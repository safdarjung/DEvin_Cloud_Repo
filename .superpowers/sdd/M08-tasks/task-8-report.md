Packet: T-0NN M08-T8 Leave actions (people.leave.request/approve/reject/cancel)
Files changed: src/modules/people/leave.actions.ts (new); tests/db/leave-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import, append); tests/security/escalation.test.ts (+4 fixtures, append)
Behavior implemented: people.leave.request inserts via RLS client (defaults staffId to own, forbidden for others unless owner/principal/admin, RLS/trigger conflict mapped to AppError); approve/reject/cancel call decide_leave RPC, errors mapped via mapSqlError's code: prefix. No TS audit on RPC path (RPC audits once); request audits leave.requested (id only).
Tests run: pnpm test:db tests/db/leave-actions.test.ts -> 8 passed; pnpm test tests/unit/action-names-unique.test.ts -> 4 passed; pnpm test:security tests/security/escalation.test.ts -> 838 passed, 4 failed (all in people.staffAttendance.mark, T7's file, not touched here); pnpm lint (my files) -> clean; pnpm typecheck -> clean for my files, 1 pre-existing error in substitution.actions.ts (T9) and 1 in curriculum.actions.ts, both pre-existing/other packets.
Tests not run and why: full test:db/test:security per brief (DB owner rule); only targeted files run.
Limitations / honesty label: no UI this milestone (none added).
Security / integration risks: none new; decide_leave RPC enforces state machine + non-self-approval server-side, action layer only adds input shaping.
Follow-ups: none for T8. T7's 4 escalation failures (staffAttendance.mark forbids admissions/accountant/exam_controller/teacher despite 's' permission cell) are pre-existing, flag to T7 owner/controller.
New dependencies: none.
Assumptions made: cancel permission check left to decide_leave RPC (requester/approver), matching rulings; request's own-staff admin check done in handler before DB round-trip.
