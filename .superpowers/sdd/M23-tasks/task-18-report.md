Packet: M23-T18 Approvals union: workflow_run + queued agent runs

Files changed:
- src/modules/core/approvals.queries.ts (edit)
- tests/db/approvals-workflow-runs.test.ts (new)

Behavior implemented: new `pendingWorkflowRunApprovals` block (gate
`workflow.manage` + `workflows` module) lists `awaiting_approval`
`workflow_runs`, oldest first, title `"${workflow.name}: ${approval
node's prompt}"` (looked up in `graph.nodes` by `cursor_node_id`),
`requestedBy: "Automation"`. Extended `pendingAgentRunApprovals`: now
also selects `queued` rows with `workflow_run_id` not null, visible only
to `requested_by === ctx.user.id` (not a decision, so `canDecideRun` is
not applied), title `"<Agent> agent: workflow task waiting to start"`.

Tests run:
- `pnpm test:db tests/db/approvals-workflow-runs.test.ts
  tests/db/approvals-agent-runs.test.ts tests/db/approvals-pending.test.ts`
  -> 3 files, 12/12 passed.
- `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` -> clean.

Tests not run and why: none skipped from ACCEPT list.

Limitations / honesty label: none (no UI; widget already carries
`<LimitedBadge>` policy upstream, unchanged here).

Security / integration risks: none found. `workflow_run` gate checked
against RLS (admin can SELECT but lacks `workflow.manage`, matches 07
§2.2). Queued-task visibility is requester-only, independent of
`agent.approve`/role, so no escalation path.

Follow-ups: none new.

New dependencies (justification): none.

Assumptions made: title's prompt text is shown verbatim, untruncated
(CSS `truncate` class handles display, matching the other approval
sources); queued-task `requestedBy` shows the real requester's profile
name (spec's example only pins the title string).
