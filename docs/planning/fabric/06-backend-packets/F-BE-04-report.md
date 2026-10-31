Packet: F-BE-04 Fabric demo store
Files: src/modules/fabric/store/{state,reducer,schema,persist,use-demo-store,index}.ts, tests/unit/fabric-store.test.ts
Behavior: pure reducer over DemoState (localStorage-backed, SSR-safe), 21 intents:
setLayout, installModule, uninstallModule, setInstallStatus, saveScenario, deleteScenario,
submitRequest, setRequestStatus, saveProposal, advancePipeline, saveWorkflow, setWorkflowStatus,
upsertMemory, deleteMemory, upsertGoal, toggleTask, saveIntervention, setInsightStatus,
recordInsightAction, measureOutcome, setNote, importState, reset.
No-op intents (missing id, identical value) return same state ref.
Tests: pnpm typecheck && pnpm lint && pnpm vitest run --project unit tests/unit/fabric-store.test.ts
→ typecheck/lint clean for fabric files; 27/27 passed. Full `pnpm test` run has 1 pre-existing
unrelated failure in tests/unit/nav.test.ts (other packet's file, untouched).
Not run: pnpm test:db/test:e2e (not applicable, no DB/UI in this packet).
Honesty label: n/a (no UI).
Risks: schema.ts validates structure + string length only, not each row's full
types.ts shape — a malformed-but-structurally-valid import (wrong enum value, etc.)
passes parseImport; callers using the data get a type assertion (`as unknown as DemoState`),
not a runtime guarantee of every field. useDemoStore selectors must return referentially
stable values or re-renders loop.
Follow-ups: none filed.
New deps: none.
Assumptions: advancePipeline picks the proposal with highest `version` for a request_id,
advances one pipeline stage at a time (first pending -> running; running -> done + next
pending -> running). installModule/uninstallModule are separate from setInstallStatus:
the former add/remove rows, the latter only flips status.
