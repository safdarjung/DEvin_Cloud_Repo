Packet: M23-T8 Engine `runWorkflow`
Files changed: src/modules/workflows/engine.ts (new), tests/unit/workflows-engine.test.ts (new)
Behavior implemented:
- Exports `NodeOutcome`, `EnginePorts`, `EngineStart`, `EngineResult`, `runWorkflow(graph, start, ports)` exactly per rulings. Pure; IO only via ports; every step `at = ports.now()`.
- Walks one path: trigger done (note = kind or event key); condition gated on `WORKFLOW_METRICS[m].module`, else metric, `lastValue`, note `"<metric> = <v> (<op> <value>): <bool>"`, follows `true`/`false` (missing edge = run done); notify/report/agent gated by `NODE_MODULE` (notify roles = core), `{count}` -> `String(lastValue ?? 0)`; approval -> step `running` (note = prompt), `awaiting_approval`, cursor = node id; resume -> approval step `done` Approved/Rejected, follows that edge (missing `rejected` = done); end -> done.
- Any throw -> current node step `failed` "Failed: <msg ≤60>", run `failed`, stop; never rejects (throwing `now()` included); notes clipped to 200; >100 steps or a non-approval resume node -> `failed`.
- Result keys exactly `status, steps, cursorNodeId, lastValue`; step keys exactly `node_id, status, at, note` (unit-asserted).
Tests run:
- vitest run (scratch config = unit project without DB globalSetup) tests/unit/workflows-engine.test.ts tests/unit/workflows-graph.test.ts -> 2 files, 38/38 pass (13 engine, 25 graph). Red first: engine suite failed on missing module.
- pnpm typecheck -> clean. pnpm lint -> 0 errors (8 warnings, none in touched files); eslint on touched files -> clean.
Tests not run and why: literal `pnpm test ...` — tests/setup/global.ts needs a reachable SUPABASE_DB_URL even for `unit`; no stack in this lane (same as T1/T5/T6/T7). Scratch config lives outside the repo; repo config untouched.
Limitations / honesty label: none (pure engine, no UI).
Security / integration risks: notes hold codes/counts/labels and port notes only; port error messages are passed through (≤60 chars), so T11 must keep its `Error("<code>")` contract (no SQL text). Engine returns only this invocation's steps; T12 must append, not replace.
Follow-ups: lane-wide unit-project infra (globalSetup DB check runs for `unit`) — ticket it.
New dependencies (justification): none
Assumptions made: trigger step note = trigger kind (event key for events); end note = node label; module-off note for action nodes reuses "Module off: <key>"; resume at a non-approval node fails with step note "Failed: invalid_resume"; fee_defaulters notify gets message "".
