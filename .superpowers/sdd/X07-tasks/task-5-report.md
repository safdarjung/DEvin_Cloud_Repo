Packet: T-005 Gate pass actions (X07-T5)
Files changed: src/modules/visitors/gate-pass.actions.ts (new); tests/db/gate-pass-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import line, appended, re-read first); tests/security/escalation.test.ts (+2 C-03 fixtures, appended, re-read first)
Behavior implemented: createGatePass (visitors.gatePass.create, gatepass.manage) inserts gate_passes relying on 0090's gate_pass_before_insert trigger for collector snapshot/validation; maps 23505->conflict fieldErrors.studentId, 42501->forbidden, 23503->not_found, trigger code:validation_failed via mapSqlError. setGatePassStatus (visitors.gatePass.setStatus) reads current status (not_found if out of RLS scope/missing), one UPDATE, DB guard enforces transition table (invalid_state), audits before/after status. Audit action strings use snake_case (visitors.gate_pass.create/set_status) per record_audit_event's dotted-lowercase check (precedent: curriculum.lessonPlan.upsert -> audit "curriculum.lesson_plan.upsert").
Tests run: pnpm test:db tests/db/gate-pass-actions.test.ts -> 6/6 pass; pnpm test tests/unit/action-names-unique.test.ts -> 6/6 pass; pnpm test:security tests/security/escalation.test.ts -> 1132/1132 pass; pnpm lint clean; pnpm typecheck clean.
Tests not run and why: full pnpm test:db / db:reset (brief forbids non-owner); T6-T10 scope.
Limitations / honesty label: none new.
Security / integration risks: none found; RLS 42501/not_found paths exercised (subject-only teacher, accountant).
Follow-ups: T10 acceptance walks this; T11 docs.
New dependencies: none.
Assumptions made: insert payload sends placeholder collector_name/collector_relation/requested_by (empty/ctx.user.id) to satisfy the generated Insert type — trigger always overwrites them for a real-user (non-service_role) caller, per 0090's gate_pass_before_insert.
