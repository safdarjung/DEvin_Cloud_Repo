Packet: M27-T3 Seed section `fabric` part 2 — forecasts, agents, reset determinism
Files changed: scripts/seed/sections/fabric.ts (Edit: part 2), tests/db/seed-fabric.test.ts (Edit)
Behavior: run(ctx) gains runForecastStep (synthetic forecast.run job, real engine) and seedAgentRuns (6 agent_definitions on conflict (institution_id,slug) do nothing; 4 literal agent_runs on conflict (id) do nothing — RUN-ATT-DONE/RUN-COM-FAILED/RUN-ADM-REJECTED/RUN-FIN-APPROVAL per the table, timestamps 50h/26h/6h/2h ago). SEEDED_RUN_MARKER exported. Never imports agents/{executor,service-role}.ts (both `import "server-only"`, which throws under plain node) — catalog.ts only.
Tests run: `pnpm test:db tests/db/seed-fabric.test.ts` 1 file/13 tests pass (6 part-1 + 2 forecasts + 4 agents + 1 reset-determinism). `DEMO_RESET_ALLOWED=true pnpm demo:reset` completes: fabric step 1.3s, forecast.run → 73 backtests/219 forecasts, mastery-gap defect (T2, not mine) still skips PLAN-VI-A-ACTIVE. `pnpm lint` 0 errors (11 pre-existing warnings, none in touched files). `pnpm typecheck` clean.
Tests not run: full test:db/test:security suites (left to checkpoints, BRIEF-COMMON).
Limitations: RUN-ADM-REJECTED's note text and admProposal input aren't asserted against AddEnquiryNoteSchema in the test (not in T3's TEST FIRST list; only the finance proposal's schema+catalog-key check was required).
Security/integration risks: none new — same service-role upsert pattern as other sections; agent_runs/agent_definitions grants (0095) already block authenticated writes beyond is_enabled.
Follow-ups: none new; M27-T2's detector.ts planAuthor defect (owner-role requirement) still open, tracked there.
New dependencies: none
Assumptions: finance proposal's termId = ctx.termIds.term2 (the current/overdue term, per finance.ts's own generateAndPay(term2, "2026-10-01", true) precedent).
