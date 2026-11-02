Packet: T-6 M14-T6 Lifecycle actions (module student_lifecycle)
Files changed: src/modules/lifecycle/actions.ts (new); tests/db/lifecycle-actions.test.ts (new);
src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+3 fixtures)
Behavior implemented: lifecycle.promote (academics.manage) -> promote_students RPC, {batchId,
promoted, graduated, skippedStudentIds}. lifecycle.transfer/withdraw (student.write) -> exit_student
RPC with kind transferred_out/withdrawn, {eventId, tcNo}. Thin wrappers, mapSqlError, no TS audit
dup (SQL audits). LANE B ruling (top of M14-tasks.md): skipped module field, ModuleKey line, and
the "module disabled" test — MOD not merged in this tree.
Tests run: pnpm test:db tests/db/lifecycle-actions.test.ts -> 5 passed; pnpm test
tests/unit/action-names-unique.test.ts -> 4 passed; pnpm test:security
tests/security/escalation.test.ts -> 902 passed; pnpm lint -> clean; pnpm typecheck -> clean.
Tests not run: full test:db, db:reset/db:types/seed (non-owner restriction).
Limitations / honesty label: none; no module gating test per lane-B ruling.
Security / integration risks: none found; permission checks confirmed via escalation suite.
Follow-ups: MOD retrofit must add module:"student_lifecycle" to these 3 actions + the disabled test.
New dependencies: none.
Assumptions made: T1/T3/T4 (schemas, promote_students, exit_student) already merged in tree — verified
present before starting.
