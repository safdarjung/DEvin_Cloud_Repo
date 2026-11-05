Packet: M23-T7 Graph validator `parseGraph` + `triggerColumns`

Files changed:
- src/modules/workflows/graph.ts (new)
- tests/unit/workflows-graph.test.ts (new)

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
- pnpm lint: PASS (0 errors; pre-existing unrelated warnings elsewhere)
- pnpm test tests/unit/workflows-graph.test.ts: blocked, same pre-existing
  Vite/postgres `extractInlineSourceMap` crash as T1/T5/T6 (global setup
  connects to Supabase even for the `unit` project; no stack in this lane).
  Worked around with a standalone jiti-loaded harness executing all 23
  scenarios from the test file plus triggerColumns/nextNode (47 assertions,
  identical logic to the vitest file) directly against graph.ts: 47/47 pass.

Tests not run and why: `pnpm test` runner itself (infra, not this task).

Limitations/honesty: none.

Security/integration risks: none — pure function, no IO.

Follow-ups: lane-wide vitest unit-project infra break (global.ts requires
SUPABASE_DB_URL reachable even for `unit`) should get its own ticket; blocks
every unit test in this lane since T1.

New dependencies: none.

Assumptions made: M22 (agents module) not merged in this lane — no
`src/modules/agents/catalog.ts` exists. Per the milestone ruling only T10/
T18/T19 are BLOCKED by this; T7 proceeds with a local, documented shortcut:
`AGENT_SLUGS` copied verbatim (6 slugs, table order) from
docs/planning/fabric/06-backend-packets/M22-tasks.md's catalog table, with a
comment to switch to the real import once M22 lands here. Skipped the
`../../lib/modules/catalog.ts` type import listed in the packet's Imports
line — nothing in parseGraph needed a `ModuleKey` type (module-enabled
checks are the engine's job, T8), so it would have been dead code.
