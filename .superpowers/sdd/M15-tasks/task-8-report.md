Packet: M15-T8 Runner sweep port
Files changed: src/modules/jobs/runner.ts; tests/unit/jobs-runner.test.ts
Behavior implemented: `RunnerPorts.enqueueDueReports(): Promise<number>` added to the interface. `createRunnerPorts` implements it as `admin.rpc("enqueue_due_reports")`, throws on RPC error, returns the count. `runOnceCore` calls it once before the claim loop inside try/catch; on reject, logs `[<correlationId>] report sweep failed` (message only, no payloads) and proceeds to claim as normal. `RunOnceSummary` shape unchanged.
Tests run: `pnpm test tests/unit/jobs-runner.test.ts` → 33 passed (28 pre-existing + 5 new: sweep-once-before-claim ordering, sweep-reject leaves summary/claims unaffected, real port calls `enqueue_due_reports` RPC + returns count, real port throws on RPC error, `fakePorts` default `enqueueDueReports`). `pnpm lint` clean. `pnpm typecheck` clean.
Tests not run and why: tests/db/* not run (no DB test file named by this task; brief forbids running others' db/security files).
Limitations / honesty label: n/a (internal runner plumbing, no user-facing surface).
Security / integration risks: none new — sweep only calls the existing service_role-only `public.enqueue_due_reports` RPC (shipped by T5, migration 0077); failure is swallowed and logged like other runner error paths, never blocks job claiming.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: `enqueue_due_reports` takes no args (confirmed in migration 20261028000077_scheduled_reports.sql line 449) and generated type exists in src/lib/db/types.ts (confirmed, not regenerated).
