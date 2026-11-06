Packet: M22-T10 Approvals union: agent_run source
Files changed: src/modules/core/approvals.queries.ts (edit: +1 branch, +1 fn); tests/db/approvals-agent-runs.test.ts (new)
Behavior implemented: pendingApprovals gains agent_run block, gated on agent.run + isModuleEnabled(ctx,"agents"); queries agent_runs status=awaiting_approval oldest-first, filters via catalog.ts canDecideRun, title "<Agent name>: <n> action(s) to approve" (n = proposals.length), requestedBy from profiles, never the task text.
Tests run: pnpm test:db tests/db/approvals-agent-runs.test.ts tests/db/approvals-pending.test.ts -> 5/5 pass. pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: full test:db skipped per brief (own files only).
Limitations / honesty label: n/a, no UI surface this task.
Security / integration risks: none new — read-only, reuses existing RLS (agent_runs SELECT owner/principal/admin) + canDecideRun (T3); no new write path.
Follow-ups: none for T10. T11 acceptance test can assert this union surfaces an awaiting_approval run if it wants end-to-end coverage.
New dependencies (justification): none.
Assumptions made: prior interrupted T10 attempt was BLOCKED (src/modules/core/approvals.queries.ts didn't exist in this worktree then); M16 has since merged into lane-h (f2f9a41), unblocking this task — proceeded without re-asking.
