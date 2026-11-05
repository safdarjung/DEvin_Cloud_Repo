Packet: M24-T6 Route `/api/ai/agent/assistant`
Files changed: src/app/api/ai/agent/assistant/route.ts (new); tests/unit/assistant-route.test.ts (new)
Behavior implemented: POST handler, gate order cross-site -> body cap -> Zod ->
getTenantContext -> requirePermission(ai.generate) -> isModuleEnabled(ai_teacher)
-> pickAssistantProvider -> buildAssistantTools(ctx, provider, nonce) ->
stripToText -> (cloud: redact user text parts only, sum redactions) ->
convertToModelMessages -> streamAgent (local) / streamCloudAgent (cloud) ->
apiResponse on {ok:false} -> toUIMessageStreamResponse with finish metadata
{provider, catalogVersion, sources}. System prompt per rulings, nonce-delimited.
Found on start: no partial edits for this task; T1-T5 exports all present and
matched EXPORTS as specified; built directly on them.
Tests run: pnpm test tests/unit/assistant-route.test.ts tests/unit/teacher-agent-route.test.ts
-> 2 files, 35 passed, 0 failed. pnpm lint (both new files) -> clean.
pnpm typecheck -> clean (repo-wide, next typegen + tsc --noEmit).
Tests not run and why: tests/db (no DB commands this task); T7 acceptance (own task).
Limitations / honesty label: n/a, no UI surface; no persistence, usage rows only
(via streamAgent/streamCloudAgent, unchanged).
Security / integration risks: none new; no admin client; module-disabled fails
closed as ai_unavailable before tools/stream are built; cloud redaction covers
only user-role text parts per rulings (assistant/system text never redacted).
Follow-ups: none new; known debt rows (mastery.declineBySection, hosted demo
ai_unavailable, accountant/exam_controller lack ai.generate) tracked in T8.
New dependencies: none.
Assumptions made: redaction scoped to user-role messages only (rulings say
"every user text part"), not assistant-authored text in history.
