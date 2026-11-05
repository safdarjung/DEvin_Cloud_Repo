Packet: T-0NN M27-T4 RLS catalog audit, cross-tenant INSERT probe, expectation reconciliation
Files changed: tests/security/rls-generated.test.ts, tests/security/rls-expectations.ts
Behavior implemented: 4 new C-01 its — RLS enabled on every discovered tenant table; write:[] tables have no permissive write policy; write-roled tables have one; cross-institution INSERT ({institution_id: B} only) rejected (42501 or coded P0001) for every table × role. Added `insertProbeException?` to TableExpectation.
Tests run: pnpm test:security tests/security/rls-generated.test.ts -> 765/765 pass. pnpm test:security (full) -> 2294/2294 pass. pnpm lint (touched files) -> clean. pnpm typecheck -> clean.
Tests not run and why: pnpm test:db — brief forbids full run, no db file touched.
Triage (TEST FIRST surfaced 2 failures):
  (a) entry fix — `jobs.write` was ["owner","principal","admin"] with stale comment "UPDATE (requeue) only"; migration 0012 dropped jobs_update (HIGH escalation fix) in favour of jobs_requeue() definer, no table write policy exists. Fixed to write: [].
  (b) `guardian_students` INSERT recurses 42P17, not 42501/coded P0001 (DBT-45, already documented in HANDOFF.md/M14-tasks.md). Added insertProbeException: "DBT-45" (still asserts an error, not the specific code).
Scope note: M27 ruling lists 45 "new tables" (M19-M25, X01-X08) for reconciliation. This worktree (lane-j, main @ dabb8b1) has only M12-M15/M18 merged — queried the DB directly: none of those 33 tables exist here yet (they're in other lanes' unmerged work). Reconciled the 12 that do exist (M12-M15) against their migrations (0074-0077, 0083) — all correct, no changes. The other 33 are out of this lane's reach; re-run T4's reconciliation once they're merged to main.
Honesty label: n/a (test-only change).
Security/integration risks: none — tightens/corrects test coverage, no runtime code touched.
Follow-ups: reconcile the 33 not-yet-merged tables' rls-expectations.ts entries once M19-M25/X01-X08 land on main.
New dependencies: none.
Assumptions made: "go faster, add more lanes" (user) is an orchestration-level instruction outside a single worktree lane's authority — proceeded on the assigned task at normal speed; did not spawn lanes or touch other worktrees.
