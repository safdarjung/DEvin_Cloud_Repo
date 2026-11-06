Packet: M23-T13 Runner sweep port `enqueueDueWorkflows`
Files changed: src/modules/jobs/runner.ts, tests/unit/jobs-runner.test.ts
Behavior implemented: `RunnerPorts.enqueueDueWorkflows(): Promise<number>`; real port
`admin.rpc("enqueue_due_workflows")`, throws on RPC error, mirrors `enqueueDueReports`.
`runOnceCore` calls it once per run, after the existing report sweep, before the
claim loop, in its own try/catch (`[<cid>] workflows sweep failed` on reject;
loop continues unaffected). `fakePorts` gains `enqueueDueWorkflows: vi.fn(async () => 0)`.
Tests run: TDD red first (3 new tests failed: not a function / not called).
`pnpm test tests/unit/jobs-runner.test.ts` → 37 passed, 0 failed.
Tests not run and why: tests/db/* and :security — no DB commands per lane rule; not touched.
Limitations / honesty label: n/a (no UI, no AI).
Security / integration risks: none — real port is a straight RPC passthrough,
same shape as the existing report sweep; no new privilege surface.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: `enqueue_due_workflows` RPC type already present in
src/lib/db/types.ts (added by earlier task in this lane, uncommitted) — used
as-is, not regenerated (not DB owner this task).
Lint/typecheck: `pnpm lint` clean for touched files (pre-existing warnings only
in tests/unit/mastery-schemas.test.ts, not mine). `pnpm typecheck` clean.
