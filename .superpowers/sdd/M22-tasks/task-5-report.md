Packet: M22-T5 Tool builder — registry → scoped agent tools
Files changed: src/modules/agents/tools.ts (new, server-only); tests/unit/agents-tools.test.ts (new)
Behavior implemented:
- Exports `toolNameFor`, `createProposalSink` (cap 5, input JSON cap 4,000; `list()` returns a copy), `buildAgentTools(ctx, slug, sink, nonce) → { tools, registryNameOf }`, `agentPermissions(slug)` (sorted unique meta permissions of catalog tools + actions). Also exports `ProposalSink` type and constants `MAX_PROPOSALS`, `MAX_PROPOSAL_INPUT_CHARS`, `MAX_TOOL_RESULT_CHARS` for T6.
- Manifests load through `await import` inside `loadManifests()`, so there is no static cycle.
- Read tool is offered only when the query is in the catalog, registered, has a string `meta.permission` the role holds (`hasPermission`) and its module is enabled. It calls the registered query with `(ctx.institution.slug, input)`. Output is the data JSON cut to 4,000 chars and wrapped in `<data-NONCE>…</data-NONCE>`. A failed query returns `Query failed: <code>`; a throw returns `Query failed: internal` (logged).
- Proposal tool `propose_<name>` is offered when the action is in the catalog, registered, has a proposable `ACTION_RISK` and its module is enabled. It calls only `sink.add` and returns the 3 fixed strings.
- `registryNameOf` maps every tool name, read and proposal, to its registry name.
- inputSchema is `jsonSchema(z.toJSONSchema(meta.schema, {target:"draft-7", io:"input", unrepresentable:"any"}))` with no validate step. Raw input goes to the query/action, whose own Zod parse is the single validation. This avoids parsing transformed output twice.
Tests run: `pnpm test tests/unit/agents-tools.test.ts` → 12 passed / 0 failed. `pnpm test tests/unit/agents-catalog.test.ts` → 31 passed (no regression). `pnpm lint` → clean. `pnpm typecheck` → clean.
Tests not run and why: no DB tests (brief says no DB commands). Executor integration is T6.
Limitations / honesty label: none here. The catalog (T3) already dropped `dashboard.attendanceTrend` and `core.approvals.pending` because they are not registered. Absent names are skipped at build time anyway, so they appear automatically once registered.
Security / integration risks:
- Proposal tools are offered without a permission check, per the ruling. Execution re-checks permission through the registry (T6/T8).
- A query that throws a Next redirect/notFound becomes `Query failed: internal` and is not re-thrown. That is intended for agent runs.
- A model can propose invalid input. The action's Zod rejects it at execution (`validation_failed`).
Follow-ups: T6 uses `registryNameOf` for `Called <query>` / `Unknown tool <name>` logs; tool errors from bad input are AI SDK tool-error parts.
New dependencies (justification): none
Assumptions made:
- Tests use `{ modules: { ...allModulesOn(), finance_plus: false } }` so the gate test stays focused.
- Role gate test uses a teacher, who holds neither finance.read nor finance.structure.manage.
- An action with no registered meta, or a query/action with no module, is not offered (fail closed).
