Packet: M19-T15 Runner sweep port `enqueueDueInsights`
Files changed: src/modules/jobs/runner.ts; tests/unit/jobs-runner.test.ts
Behavior implemented: Added `RunnerPorts.enqueueDueInsights(): Promise<number>`; real port calls `admin.rpc("enqueue_insight_detection")`, throws on error. `runOnceCore` calls it once, right after the reports sweep, before the claim loop, in its own try/catch; on rejection logs `[<cid>] insights sweep failed` and continues (jobs still claimed, reports sweep still runs). `RunOnceSummary` unchanged. `fakePorts` test helper gained `enqueueDueInsights: vi.fn(async () => 0)`.
Tests run: `pnpm test tests/unit/jobs-runner.test.ts` → 37/37 pass (5 new: order+rejection in runOnceCore, real-port call+RPC-error for createRunnerPorts). `pnpm lint` clean. `pnpm typecheck` clean.
Tests not run and why: none skipped; task has no DB/security scope.
Limitations / honesty label: n/a, no UI/labels touched.
Security / integration risks: none new — mirrors M15 `enqueueDueReports` pattern exactly; RPC `enqueue_insight_detection` (T6) does its own `app.module_enabled` gate server-side.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: none — spec gave exact call site, log line, and test list.
