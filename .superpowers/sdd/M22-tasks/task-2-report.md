Packet: M22-T2 Migration 0095 — agent_definitions, agent_runs, guard, ai_usage_events.agent_run_id
Files changed: supabase/migrations/20261028000095_agents.sql (new); tests/db/agents-rls.test.ts (new); src/lib/db/types.ts (regen, raw); tests/security/rls-expectations.ts (edit: 2 entries, C-01 demanded it)
Behavior implemented: agent_definitions (select owner/principal/admin; update is_enabled-only owner/principal) + agent_runs (select owner/principal/admin; no authenticated write at all) + composite FK agent_id->(id,institution_id) + app.guard_agent_run_update (BEFORE UPDATE, no bypass, enforces the 6-state machine + immutable identity cols/decided_by) + ai_usage_events.agent_run_id (no FK) + partial index.
Tests run: pnpm test:db tests/db/agents-rls.test.ts -> 5/5 pass; pnpm test:security tests/security/grants.test.ts tests/security/rls-generated.test.ts -> 779/779 pass; pnpm lint -> clean; pnpm typecheck -> clean.
Tests not run and why: none skipped; full pnpm test:security/test:db left to controller gate.
Limitations / honesty label: n/a (no UI/user-facing surface this task).
Security / integration risks: none found; grants.test.ts needed no edit (no new definer/public RPC — guard is a plain invoker trigger, excluded from its name lists).
Follow-ups: none for this task; T4/T6/T7 consume agent_run_id/agent_id/catalog_version as specified.
New dependencies (justification): none.
Assumptions made: two cross-institution agents-rls.test.ts cases given explicit 15000ms timeouts (default 5000ms was tight under this machine's concurrent-lane load, not a logic issue — 2x9 real auth-user signups per case). db:reset/db:types run as DB owner; seed completed (students 3024 etc).
