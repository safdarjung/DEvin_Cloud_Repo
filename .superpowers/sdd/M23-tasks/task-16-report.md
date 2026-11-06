Packet: M23-T16 Actions `workflow.runNow`, `workflow.run.decide`

Files changed:
- src/modules/workflows/actions.ts (edit, append)
- tests/db/workflows-run-actions.test.ts (new)
- tests/security/escalation.test.ts (append 2 C-03 fixtures)

Behavior implemented:
- `runWorkflowNow` (`workflow.runNow`, `workflow.manage`): rpc `start_workflow_run(p_workflow_id)` -> `{ runId }`.
- `decideWorkflowRun` (`workflow.run.decide`, `workflow.manage`): rpc `decide_workflow_run(p_run_id, p_decision, p_note?)` -> `{ runId, status }`.
- Both thin wrappers; the 0096 RPCs already enforce not_found/forbidden/invalid_state/validation_failed and write their own audit row, so handlers only `mapSqlError` + shape output (no app-layer audit call needed, unlike T15's direct-table actions).

Tests run:
- `pnpm test:db tests/db/workflows-run-actions.test.ts` -> 5/5 PASS
- `pnpm test:security tests/security/escalation.test.ts` -> 1562/1562 PASS
- `pnpm test tests/unit/action-names-unique.test.ts` -> 6/6 PASS
- `pnpm lint` -> 0 errors (8 pre-existing warnings in tests/unit/mastery-schemas.test.ts, untouched)
- `pnpm typecheck` -> clean

Tests not run and why: none; full ACCEPT gate run.

Limitations / honesty label: none; no UI surface this task.

Security / integration risks: none found. Decision note never leaves the `decision_note` column / `AppError` path into audit metadata — verified `after` column equals `{run_id, node_id}` only (bug caught in my own test: SQL's `app.audit` call writes the payload to `after`, not `metadata` — fixed the assertion, not the SQL).

Follow-ups: none.

New dependencies (justification): none.

Assumptions made: none beyond rulings; `decide_workflow_run`'s returned row cast to `{id, status}` (full `workflow_runs` row at runtime).
