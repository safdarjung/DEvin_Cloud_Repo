Packet: M24-T4 Export `buildReadTools` from the M22 tool builder
Files changed: src/modules/agents/tools.ts (edit); tests/unit/agents-tools.test.ts (edit)
Behavior implemented: buildReadTools(ctx, catalog, nonce, onOk?) extracted as
the read-tool half of buildAgentTools (manifest load, eligibility, wrapping,
never-throw unchanged); onOk(name, input) fires once per ok query, before
wrapping. buildAgentTools now builds its read tools via buildReadTools; M22
behaviour unchanged (existing 12 cases still pass).
Found on start: tools.ts/test diff already matched spec (earlier interrupted
run), but the new onOk test called the real finance.listDefaulters query
without an acting client set -> failed. Fixed by faking the registry entry
(ok stub), matching the existing test pattern.
Tests run: pnpm test tests/unit/agents-tools.test.ts tests/unit/agents-executor.test.ts
-> 2 files, 31 passed, 0 failed. pnpm lint (both files) -> clean. pnpm typecheck
-> clean.
Tests not run and why: tests/db (no DB commands this task); tests/unit/assistant-*
(other tasks' files).
Limitations / honesty label: n/a, no UI surface.
Security / integration risks: none; logic moved only, eligibility checks
(permission + module) unchanged.
Follow-ups: none new.
New dependencies: none.
Assumptions: left tests/unit/assistant-catalog.test.ts's uncommitted
"Registry validation" edit untouched (not a T4 file; appears to belong to
another concurrent task/agent).
