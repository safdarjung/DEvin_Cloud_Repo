Packet: T-0NN M08-T9 Substitution actions (timetable.substitution.assign/cancel) + db test + C-03
Files changed: src/modules/timetable/substitution.actions.ts (new), tests/db/substitution-actions.test.ts (new), src/app/api/v1/actions/all-actions.ts (+1 import), tests/security/escalation.test.ts (+2 C-03 fixtures)
Behavior: timetable.substitution.assign/cancel wrap assign_substitution/cancel_substitution RPCs (timetable.manage). Assign maps 23505 and the RPC's own pre-check `code:conflict` both to conflict + fieldErrors.substituteId; 42501→forbidden; no extra audit (RPC already audits).
Tests run: pnpm test:db tests/db/substitution-actions.test.ts → 4/4 pass. pnpm test tests/unit/action-names-unique.test.ts → 4/4 pass. pnpm test:security tests/security/escalation.test.ts → 842/842 pass.
Tests not run: pnpm lint/typecheck ran project-wide (brief allows; only my files checked for errors) — both clean for my files.
Limitations: no UI (none planned this task). No honesty-badge change needed.
Security/integration risks: none found; RPC-level checks already enforce ordering/role/state, action is a thin wrapper.
Follow-ups: none new (DBT-47..50 already logged by T15 scope).
New dependencies: none.
Assumptions: "conflict naming substituteId" (TEST FIRST) read as fieldErrors.substituteId for any mapped `conflict`, not only the 23505 race path — ruling's EXPORTS line scopes 23505 explicitly but the test fixture (two sequential assigns) hits the RPC's own pre-check first.
Lint/type errors seen in untouched files (not mine): src/modules/people/hr.queries.ts:157 unused var warning; src/modules/academics/curriculum.actions.ts:168 TS2345.
