Packet: M23-T11 Engine ports

Files changed:
- src/modules/workflows/ports.ts (new)
- tests/db/workflows-ports.test.ts (new)

Behavior implemented: `createEnginePorts(admin, run, workflow, settings, now)`
-> `EnginePorts` (T8 contract). `metric` = `rpc("workflow_metric")`, throws
`metric_failed`. `notify` roles -> one `workflow_alert` per active member
in the role list (paged 500), skipped if none; `fee_defaulters` -> upserts
M12's `finance.fee_reminder` job with its exact key, skipped with no
current term; errors -> `notify_failed`. `report` -> upserts
`report.generate` job for an active same-institution schedule, else
skipped; errors -> `report_failed`. `agent` -> `queueWorkflowAgentRun`
(T10), disabled def -> skipped; errors -> `agent_failed`.

Tests run:
- `pnpm test:db tests/db/workflows-ports.test.ts` -> 6/6 passed.
- `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` -> clean.

Tests not run and why: none skipped from ACCEPT list.

Limitations / honesty label: none (no UI).

Security / integration risks: none found. No raw SQL text ever thrown;
report/fee lookups scoped by institution_id.

Follow-ups: none new.

New dependencies: none.

Assumptions made: ruling's notify/report idempotency keys include
`:${nodeId}`, but T8's fixed `EnginePorts.notify/report(cfg, ...)` never
passes a node id, so keys use `run.id` alone (noted in-code); correct
while each template has at most one such node per run.
