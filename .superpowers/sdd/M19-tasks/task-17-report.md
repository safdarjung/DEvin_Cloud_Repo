Packet: M19-T17 insight.explain (AI gateway)
Files changed: src/modules/insights/explain.ts (new); src/modules/insights/explain.actions.ts (new); tests/db/insight-explain.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+1 fixture)
Behavior implemented: `toExplainInput`/`buildInsightExplainPrompt` (nonce-delimited, 11 safe fields only, no id/name) + `INSIGHT_EXPLAIN_INSTRUCTIONS`. `explainInsight` (insight.read gate, then explicit `ai.generate` check since accountant/exam_controller have insight.read but not ai.generate): reads row via user client scoped to institution, not_found/invalid_state, `runStructured({feature:"insight_explain", maxOutputTokens:1024})`, on failure rethrows as AppError (passthrough), else `set_insight_explanation` RPC, returns `{insightId, explanation, provider, model, fallback}`.
Tests run: `pnpm test:db tests/db/insight-explain.test.ts` -> 6/6 pass. `pnpm test:security tests/security/escalation.test.ts` -> 1112/1112 pass. `pnpm lint` -> 0 errors (1 pre-existing warning in another agent's file). `pnpm typecheck` -> clean.
Tests not run and why: none skipped.
Limitations / honesty label: n/a, server action only, no UI.
Security / integration risks: none new. Escalation fixture uses permission "ai.generate" (not the action's own "insight.read" gate) so the generic walk's allowed/forbidden split matches the handler's real narrower check — verified against all 9 roles.
Follow-ups: none for this task.
New dependencies (justification): none.
Assumptions made: escalation fixture permission = "ai.generate" (narrower effective gate), not the action's "insight.read" field, to keep C-03's allowed-role assertion correct for accountant/exam_controller.
