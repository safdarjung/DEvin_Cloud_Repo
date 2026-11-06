Packet: M23-T7 Graph validator `parseGraph` + `triggerColumns`

Files changed:
- src/modules/workflows/graph.ts (previously committed; this run swapped the
  local `AGENT_SLUGS` shortcut for the real `../agents/catalog.ts` import, now
  that M22 is merged in this lane)
- tests/unit/workflows-graph.test.ts (previously committed, unchanged)

Behavior implemented:
`parseGraph({nodes, edges})` validates structure (array sizes, unique ids, edge
endpoints, no self-loop/dup edge), per-type node config (trigger/condition/
notify/report/agent/approval/end; `tool` rejected), out-edge shape per type,
exactly-one-trigger with no incoming edge, acyclic + fully reachable + >=1
end, condition-metric vs trigger-event subject match, `fee_defaulters` gated
behind an approval's `approved` edge, at most one `agent` node per slug.
Returns `{ok:false, errors[]}` (cap 20) or `{ok:true, graph}`.
`triggerColumns`/`nextNode` also implemented per EXPORTS.

Tests run:
- pnpm typecheck: PASS (0 errors)
- pnpm lint: PASS (0 errors; pre-existing unrelated warnings in
  mastery-schemas.test.ts, not this task's file)
- pnpm test tests/unit/workflows-graph.test.ts: PASS, 25/25 (prior lane-wide
  Vite/Supabase infra crash noted in an earlier version of this report is
  gone — vitest runs clean now)

Tests not run and why: n/a.

Limitations/honesty: none.

Security/integration risks: none — pure function, no IO.

Follow-ups: none (previous report's follow-up — switch off the local
AGENT_SLUGS shortcut once M22 lands — done this run).

New dependencies: none.

Assumptions made: none remaining. M22's `src/modules/agents/catalog.ts` is
now present in this worktree; `AGENT_SLUGS`/`AgentSlug` imported from there
directly, matching the packet's READ line exactly.
