Packet: M22-T6 Executor — loop, outcome, proposal execution
Files changed: src/modules/agents/executor.ts (new, server-only); tests/unit/agents-executor.test.ts (new)
Behavior implemented:
- `decideOutcome({ok, proposals})` (pure): failure → `failed`/`read_only`; none → `done`/`read_only`; max low → `done`; max user/human → `awaiting_approval`.
- `executeProposals(ctx, slug, proposals)`: sequential, loads the action manifest with `await import`, only `status: "proposed"` entries run. If the action is not in `AGENT_CATALOG[slug].actions` or not registered → `skipped`/`not_allowed`. Otherwise it calls the registry action with `(ctx.institution.slug, input)` → `executed` | `failed`+code; a throw → `failed`/`internal`.
- `executeAgentRun(ctx, {runId, slug, task})` never throws. It calls `streamAgent` with the Loop-bounds values verbatim (stepCountIs(6), 1024 tokens, concurrency 1, AbortSignal.timeout(90_000), key `${id}:agents`, feature `agent.<slug>`, `agent.run`, `general`, `agentRunId`). The task goes in `<task-NONCE>`. It drains `fullStream`; an `error`/`abort` part or a throw → `failed`. Proposals are dropped and the summary is a fixed sentence (`ai_unavailable` → "The local AI engine was not available."). The log is built in code from tool names only. Proposals run only when the batch is all low-risk.
- Also exported: `logEntry(level, text)` (caps text at 200) and `AgentRunOutcome`, for T7/T8 entries ("Approved by", "Finished").
Tests run: RED first (module missing). Then `pnpm test tests/unit/agents-executor.test.ts tests/unit/agents-tools.test.ts` → 28 passed / 0 failed (executor 16, tools 12). `pnpm lint` → clean. `pnpm typecheck` → clean.
Tests not run and why: no DB tests (brief: no DB commands). There is no live Ollama run; the model is the `ai/test` MockLanguageModelV4 inside the real `streamText` + `streamAgent`.
Limitations / honesty label: none here (T12 records the "Local AI only" LimitedBadge).
Security / integration risks:
- Proposal actions run as whoever calls (the requester after the loop, the approver in T8). Each one re-checks module, Zod, permission and audit through the registry.
- Read-tool `Query failed:` results and SDK tool-error parts log `Tool error <query>`.
- An unknown tool name is model text. It is cut to 64 chars before it is logged, as the ruling requires.
Follow-ups: T7 persists the outcome as is (the log already ends with `Finished: <status>`). T8 adds its own `Approved by`/`Finished` entries with `logEntry` and must keep the log ≤ 100 entries.
New dependencies (justification): none
Assumptions made:
- An out-of-catalog proposal logs `Skipped <action> (not_allowed)`. That text is not in the ruling's log list; the status is `skipped`, so `Failed` would mislabel it.
- On failure, `riskClass` is `read_only` (proposals dropped). A non-`ai_unavailable` gateway failure gets the summary "The agent run stopped before it finished."
- `summary` = text of the final step, trimmed, ≤ 2,000 chars, and may be "".
