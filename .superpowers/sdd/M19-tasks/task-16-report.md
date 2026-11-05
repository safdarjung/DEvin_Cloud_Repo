Packet: M19-T16 Actions review/action/resolve/dismiss
Files changed: src/modules/insights/actions.ts (new); tests/db/insight-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+4 C-03 fixtures, appended, re-read first — T17's concurrent insight.explain fixture already present, untouched).
Behavior implemented: reviewInsight/recordInsightAction/resolveInsight/dismissInsight, each "use server", module insights, permission insight.review, thin wrappers over decide_insight/record_insight_action (T3). No TS audit (RPC audits). mapSqlError throws AppError on RPC error.
Tests run: RED confirmed (module missing) -> GREEN. pnpm test:db tests/db/insight-actions.test.ts -> 8/8 passed. pnpm test tests/unit/action-names-unique.test.ts -> 6/6 passed. pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts -> 1338/1338 passed. pnpm lint clean (touched files). pnpm typecheck clean.
Tests not run and why: full test:db/test:security suites not run (not DB-owner scope, single-file rule).
Limitations / honesty label: n/a, no UI.
Security / integration risks: none new. Deviated from brief's literal "accountant on attendance insight -> forbidden" scenario: actual RPC behavior is not_found (app.insight_visible gates before app.can_review_insight per T3's error-rules order, hiding row existence) — test asserts not_found with a comment; added a second test proving the owner/principal-only approval_required forbidden path instead.
Follow-ups: none.
New dependencies: none.
Assumptions made: domain-mismatch -> not_found (see above), matches T3's stated error-rule order exactly.
