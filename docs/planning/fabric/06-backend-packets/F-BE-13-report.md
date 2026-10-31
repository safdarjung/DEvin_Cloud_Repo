# F-BE-13 Fixture Report

**Packet**: F-BE-13 fixture `agents`

**Files changed**: 
- `src/modules/fabric/demo/agents.ts` (created)
- `tests/unit/fabric-fixtures/agents.test.ts` (created)

**Behavior implemented**: 
Deterministic fixture generators for Fabric agents, agent runs, workflows, and workflow runs. Four exports: `agentDefinitions()` → 8 agents with varied risk classes; `agentRuns()` → 30 runs (14 days, 3 awaiting_approval, 3–6 log lines each); `workflows()` → 5 workflows (6–9 nodes each, ≥1 approval node, 220px x-spacing); `workflowRuns()` → 8 runs with consistent step order. All strings ≤200 chars. Deterministic PRNG seeding for reproducible test data.

**Tests run**: 
`pnpm test tests/unit/fabric-fixtures/agents.test.ts` → 24 tests passed. Validates counts, same-seed deep-equality, agent_id/workflow_id validity, edge endpoints, and cross-fixture consistency.

**Verification**: 
- `pnpm lint -- src/modules/fabric/demo/agents.ts tests/unit/fabric-fixtures/agents.test.ts` → clean
- No new dependencies
- Contract types unchanged; generated per packet spec

**Limitations/Honesty label**: 
None. Fixture data is synthetic demo-only; approval node placement is forced to guarantee ≥1 per workflow.

**Assumptions made**: 
- Today's date: 2026-10-31
- Institution ID for fixtures: inst-0001
- Agent run log entries deterministic but varied in level (info/warn/error)
