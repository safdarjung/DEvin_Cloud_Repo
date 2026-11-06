Packet: M23-T10 Agent queue helper

Files changed:
- src/modules/agents/queue.ts (new)
- tests/db/agents-queue.test.ts (new)

Behavior implemented: `queueWorkflowAgentRun(admin, input)`, plain-node
safe. Unknown slug throws `invalid_agent`. Upserts the 6 catalog
definitions (`on conflict (institution_id, slug) do nothing`). Disabled
definition -> `{ status: "disabled" }`, no run. Else inserts `agent_runs`
(`queued`, `risk_class read_only`, current `catalog_version`,
`workflow_run_id`); a repeat call for the same (workflow_run_id, agent_id)
hits the partial unique index `agent_runs_workflow_agent_key` (23505) and
reads back the existing run id instead of erroring — PostgREST's
`on_conflict` can't target a partial index directly (no WHERE support), so
insert+catch-23505 replaces the literal "on conflict do nothing" from the
ruling, same observable result.

Tests run:
- `pnpm test:db tests/db/agents-queue.test.ts` -> 1/1 passed (queue+
  idempotent+6 defs+disabled+unknown-slug, one fixture institution).
- `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` -> clean.

Tests not run and why: none skipped from ACCEPT list.

Limitations / honesty label: none (no UI).

Security / integration risks: none found. Insert always carries
`risk_class: "read_only"` and `status: "queued"` (matches 0095's
`agent_runs_awaiting_risk_check`); no user-controlled institution/agent
binding (both come from the server-chosen definition row).

Follow-ups: none new.

New dependencies (justification): none.

Assumptions made: `on conflict (workflow_run_id, agent_id) do nothing`
(ruling wording) implemented as insert + 23505 catch since that index is
partial and PostgREST upsert can't express its WHERE predicate; T11/T12
(callers) get the same `{status, runId, created}` shape either way.
