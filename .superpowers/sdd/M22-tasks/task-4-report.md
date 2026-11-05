Packet: M22-T4 Link usage rows to runs (agentRunId through streamAgent → logUsage)
Files changed: src/lib/ai/gateway.ts (edit); src/lib/ai/usage.ts (edit); tests/unit/ai-gateway.test.ts (edit)
Behavior implemented:
- `StreamAgentInput.agentRunId?: string`; `streamAgent` computes `agentRunId = input.agentRunId ?? null` once and passes it on all 3 `logUsage` calls inside it (quota/rate-limit failure, success, totalUsage-rejected failure).
- `UsageEvent.agentRunId?: string | null`; `logUsage` inserts `agent_run_id: event.agentRunId ?? null`.
- `runStructured` untouched (its own 3 logUsage calls have no agentRunId field, same as before — cloud path still refused).
Tests run: TDD — added 3 failing tests first (success/quota-failure carry "run-1", omitted → null); confirmed RED (3 failed/22 passed), then implemented → GREEN.
`pnpm test tests/unit/ai-gateway.test.ts tests/unit/student-agent-route.test.ts` → 38 passed / 0 failed.
`pnpm lint` → clean. `pnpm typecheck` → clean (next typegen + tsc --noEmit).
Tests not run and why: no DB commands per brief (migration/types already landed in T2).
Limitations / honesty label: none, no UI surface this task.
Security / integration risks: none — purely additive optional field; no auth/RLS change; cloud step still unconditionally skipped in streamAgent (HIGH-2 unchanged).
Follow-ups: T6 (executor) passes `agentRunId: runId` into streamAgent per rulings Loop bounds.
New dependencies (justification): none.
Assumptions made: none beyond ruling text; field name `agentRunId` (camelCase) on both types, DB column `agent_run_id` already existed from T2.
