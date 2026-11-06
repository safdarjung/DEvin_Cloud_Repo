Packet: M24-T5 Assistant tool set: scoped reads, `navigate`, draft `createTask`
Files changed: src/modules/ai/assistant/tools.ts (new, server-only); tests/unit/assistant-tools.test.ts (new)
Behavior implemented: buildAssistantTools(ctx, provider, nonce) -> { tools, sources }. Reads = buildReadTools(ctx,
queriesFor(provider), nonce, sources.add) (T4; permission + module + registry filter, ok-only source logging).
navigate: z.enum over navItemsFor(permissions, settings) minus group "Fabric"; omitted when empty; returns
{ href: "/<slug><href>", label }. createTask: offered iff getActionMeta("insight.action") exists (after
await import all-actions), string permission held, module set and enabled; strict input; execute =
RecordInsightActionSchema.safeParse({...input, status:"planned"}) -> task_draft object or
"Task draft invalid: <fields>"; calls no action, writes nothing.
Found on start: both files present from an interrupted run; verified against spec, no edits needed.
Tests run: pnpm test tests/unit/assistant-tools.test.ts -> 1 file, 11 passed, 0 failed.
  With agents-tools + assistant-catalog: 52 passed, 1 failed (see below, not a T5 file).
  eslint on both files -> clean. pnpm typecheck -> clean.
Tests not run and why: tests/db (no DB commands this task).
Limitations / honesty label: n/a (no UI). Catalog names not registered in this lane, dropped by
  buildReadTools (never substituted): mastery.heatmapBySection, mastery.gapsForStudent,
  mastery.studentSuccessRows (M20 queries not merged here). So the mastery-off direct-call check is
  vacuous in this lane (guarded `if (!query) continue`); the same module-off rule is proven with the
  registered insights.riskIndicators (insights off -> forbidden + MODULE_DISABLED_MESSAGE).
Security / integration risks: none new; no admin client, no writes; navigate never accepts a free URL
  (enum; "/fabric/twin" and "javascript:" rejected in test). createTask module missing on meta -> not offered (fail closed).
Other files failing (not mine): tests/unit/assistant-catalog.test.ts uncommitted "Registry validation"
  case fails on mastery.heatmapBySection (same M20 gap); left untouched.
Follow-ups: none new (mastery gap resolves when M20 queries merge).
New dependencies: none.
Assumptions made: createTask/navigate description text chosen (rulings fix only the navigate pair list).
