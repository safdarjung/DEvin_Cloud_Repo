Packet: L1 AI dashboard briefing
Files changed:
- src/app/api/ai/dashboard-briefing/route.ts (new)
- src/modules/ai/dashboard-briefing.schemas.ts (new)
- src/modules/ai/prompts/dashboard-briefing.ts (new)
- src/modules/core/components/dashboard/DailyBriefing.tsx (new)
- src/app/(tenant)/[institution]/dashboard/page.tsx (edit: import + render DailyBriefing above KPI grid, pass existing data.* as props)
- tests/unit/dashboard-briefing-schema.test.ts (new)
- tests/unit/dashboard-briefing-prompt.test.ts (new)

Behavior implemented: button-triggered ("Summarize today") 2-3 sentence plain-English briefing above the KPI tiles. Client POSTs the SAME numbers DashboardPage already computed (attendance %, sections at risk, open enquiries, enrolled count, collections or null) to the new route; no new DB read, no PII. Route: cross-site check + 8KB body cap (mirrors quiz route), getTenantContext, requirePermission(ctx, "dashboard.view"), Zod-parses the numeric body (strict, rejects unknown/free-text fields), runStructured({feature:"dashboard_briefing"}, maxOutputTokens: 512 — smaller than quiz's 2048 since a short summary needs far less headroom). Output schema caps summary at 500 chars. UI shows LimitedBadge + ProviderBadge + "AI-written summary — the numbers below are the source of truth" on success; quiet failure (error text only) on any error code — KPI tiles unaffected either way.

Tests run: pnpm test (unit project) -> 36 files, 394 tests passed (includes the 2 new test files, 11 new tests). pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: test:db/test:security/db:types/demo/seed skipped per instructions (not DB owner this round, touched no SQL/RLS). E2E not run (no new Playwright spec requested).

Limitations / honesty label: LimitedBadge + ProviderBadge shown on every successful briefing per CLAUDE.md rule 7; docs and UI agree (no separate doc page for this feature yet).

Security / integration risks: no new DB query surface; prompt has no nonce-delimiter because there is no attacker-controlled free text (every field is a number, strict Zod schema rejects anything else) — documented in a comment in prompts/dashboard-briefing.ts. requirePermission gates the route; runStructured's own hasPermission(ctx,"ai.generate") check still applies inside the gateway.

Follow-ups: none identified.
New dependencies (justification): none.
Assumptions made: button-triggered rather than auto-on-mount, to avoid an AI/quota-consuming call firing on every dashboard page load (brief allowed either).

Fix round 1 (security review, LOW-4): accountant/exam_controller have `dashboard.view` but not `ai.generate`, so they saw "Summarize today" and always got `forbidden`. Fixed by gating render in page.tsx: `canGenerateBriefing = hasPermission(ctx, "ai.generate")`, DailyBriefing only renders when true. Files: src/app/(tenant)/[institution]/dashboard/page.tsx. Tests: pnpm test unit project -> 40 files, 423 tests passed. pnpm lint -> clean. pnpm typecheck -> clean.
