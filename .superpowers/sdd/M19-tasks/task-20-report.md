Packet: M19-T20 Approvals branch `insight`
Files changed: src/modules/core/approvals.queries.ts (+insight branch, pendingInsightApprovals); tests/db/approvals-pending.test.ts (+4 cases, plant/cleanup helper)
Behavior implemented: pendingApprovals adds a 3rd branch, gated on insight.review AND module insights; reads listInsights(ctx, {status:["new","reviewing"], limit:200}), keeps approval_required rows, sorts oldest first, maps to {id, kind:"insight", title:"Insight: <title>", requestedBy:"Insights engine", age (reused recheckAgeLabel), href:"/<slug>/fabric/insights?id=<id>"}; appended after leave+recheck.
Tests run: pnpm test:db tests/db/approvals-pending.test.ts -> 7 passed; pnpm lint -> clean; pnpm typecheck -> clean.
Tests not run and why: full test:db (DB-owner rule, single-file only this lane).
Limitations / honesty label: none; insights carry no badge (rulings: real detections).
Security / integration risks: none new — insight rows come from listInsights, which is RLS-scoped (0092) plus its own institution_id filter; no new writes, no new permission (insight.review already in permissions.ts from an earlier T19x task).
Follow-ups: none.
New dependencies: none.
Assumptions made: unblocked — M16 (approvals.queries.ts, ApprovalRow, 0078) is now merged into this worktree (ba6e266), so the earlier BLOCKED report no longer applies; test fixture plants/deletes one insights row directly via record_insights on the demo tenant (table not in CLAUDE.md rule 5's immutable list), cleaned up in afterEach so it never persists into a full test:db run.
