Packet: M23-T15 Actions `workflow.save`, `workflow.setStatus`

Files changed:
- src/modules/workflows/actions.ts (new)
- tests/db/workflows-actions.test.ts (new)
- src/app/api/v1/actions/all-actions.ts (append import, end of list)
- tests/security/escalation.test.ts (append 2 C-03 fixtures after report.schedule.setStatus)

Behavior implemented:
- `workflow.save` (`workflow.manage`): parseGraph first (fail -> validation_failed, fieldErrors.graph); triggerColumns derives trigger_type/trigger_config; insert (draft) or update-by-id; 23505 on name unique -> conflict + fieldErrors.name; guard invalid_state -> "Pause the workflow to edit it."; audit `workflow.saved` {id, version}; returns {id, version, status}.
- `workflow.setStatus` (`workflow.manage`): reads row (not_found if missing/cross-institution); target active re-runs parseGraph; guard validation_failed -> "This schedule never fires."; audit `workflow.status` {id, from, to}; returns {id, status, nextRunAt}.

Tests run:
- `pnpm test:db tests/db/workflows-actions.test.ts` -> 4/4 PASS
- `pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts` -> 1874/1874 PASS
- `pnpm test tests/unit/action-names-unique.test.ts` -> 6/6 PASS
- `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched tests/unit/mastery-schemas.test.ts)
- `pnpm typecheck` -> clean

Tests not run and why: none; full ACCEPT gate run.

Limitations / honesty label: none; no UI surface this task.

Security / integration risks: none found. Both actions gate module -> schema -> permission via defineAction before the handler; cross-institution ids filtered by `.eq("institution_id", ...)` -> not_found, never leak existence.

Follow-ups: none.

New dependencies (justification): none.

Assumptions made: "This schedule never fires." message path (rulings' validation_failed guard-code mapping) has no dedicated test in TEST FIRST list; implemented per rulings but unexercised by a db test here — low risk, single `if` branch, same shape as the exercised invalid_state branch.
