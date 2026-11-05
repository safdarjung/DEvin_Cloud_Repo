Packet: M24-T7 Acceptance under real RLS
Files changed: tests/db/assistant-acceptance.test.ts (new)
Behavior implemented: 5 real-RLS cases against the real POST handler (only
@/lib/supabase/server + @/lib/ai/providers mocked, MockLanguageModelV4
scripted per case): principal attendance-threshold (section label in tool
output, exact finish metadata+sources, real ai_usage_events row); principal
mastery heatmap (sources cite mastery.heatmapBySection); teacher has no
finance_* tool + scripted finance_listDefaulters leaks nothing, sources [],
direct registered call -> forbidden; teacher A vs section B attendance
patterns -> no leaked student name (RLS); ai_teacher off -> 503
ai_unavailable, zero usage rows.
Found on start: no partial edits for this task; T4-T6 exports all present.
Lane gap: mastery.heatmapBySection not registered here (M20 not merged in
this lane, task-5-report.md) -> faked registry+meta entry (same
Map.prototype.get spy as agents-executor.test.ts's fakeEntry, restored in
afterEach); proves T5/T6 eligibility+sources path only, no real M20 SQL.
Tests run: pnpm test:db tests/db/assistant-acceptance.test.ts -> 5 passed,
0 failed (x2, stable). pnpm lint (file) clean. pnpm typecheck (repo) clean.
Tests not run and why: full test:db (not db owner); db:reset/seed/types.
Limitations / honesty label: n/a, no UI surface.
Security / integration risks: none new; confirms real RLS blocks
cross-teacher data and forbids an under-permissioned direct query call.
Follow-ups: none new; mastery gap resolves when M20 merges.
New dependencies: none.
Assumptions made: "valid M20 input" for faked tool = {} (HeatmapQuerySchema
fields both optional, src/modules/mastery/schemas.ts).
