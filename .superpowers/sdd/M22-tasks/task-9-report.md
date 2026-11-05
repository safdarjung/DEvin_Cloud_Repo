Packet: M22-T9 Queries agents.definitions, agents.runs, agents.runDetail
Files changed: src/modules/agents/queries.ts (new), src/modules/agents/query-defs.ts (new), tests/db/agents-queries.test.ts (new), src/app/api/v1/query/all-queries.ts (+1 import line), tests/db/api-query-route.test.ts (+3 smoke samples)
Behavior implemented: agents.definitions (ensures 6 rows first, catalog order, name/tools/permissions/max_risk_class from AGENT_CATALOG+agentPermissions (tools.ts, reused)+agentMaxRisk, runs_30d/error_rate_pct/cost_paise_30d summed in TS over 30d agent_runs+ai_usage_events, model_tier "local", quality_score null). agents.runs (filters slug via agent_definitions!inner join, status, limit; newest first; approver/cost_paise hydrated from profiles+ai_usage_events batch lookups, shared helper with runDetail). agents.runDetail ({run, proposals, requestedBy, decisionNote, canDecide}; canDecideRun from catalog.ts; missing/cross-tenant row -> not_found). All three: permission agent.run, module agents, user client only.
Tests run: pnpm test:db tests/db/agents-queries.test.ts -> 7/7 pass. pnpm test:db tests/db/api-query-route.test.ts -> 7/7 pass. pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: full test:db (brief: own files only, no --).
Limitations / honesty label: none (T12 records LimitedBadge).
Security / integration risks: none new — read-only, RLS + agent.run gate unchanged; reused existing agentPermissions/agentMaxRisk/canDecideRun rather than re-deriving.
Follow-ups: none for this task; T10/T11 build on these exports.
New dependencies (justification): none.
Assumptions made: cost_paise_30d/cost_paise sum ai_usage_events by created_at >= now-30d (joined to runs' agent_id/id respectively) under the 1000-row page limit (shortcut comment in queries.ts, matches brief).
