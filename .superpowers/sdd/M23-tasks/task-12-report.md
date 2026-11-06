Packet: M23-T12 Job handler `workflow.run`

Files changed:
- src/modules/jobs/handlers/workflow.run.ts (new)
- tests/db/workflow-run-job.test.ts (new, 9 tests)
- src/modules/jobs/types.ts (+"workflow.run" to JobType)
- src/modules/jobs/registry.ts (+JOB_MODULES row "workflows", +JOB_REGISTRY entry)
- src/modules/jobs/handlers/index.ts (+workflowRun export)

Behavior implemented: payload `WorkflowRunJobPayloadSchema`; run missing/
not `running` -> no-op; `workflows` module off -> no-op; `parseGraph`
failure -> `failed` + `_run` step "Invalid workflow graph"; resume via
`pending_decision`, else fresh trigger start; `runWorkflow` via T11's
`createEnginePorts`; single end-of-attempt update (`.eq("status","running")`),
steps appended not replaced, `engine_version` set, `finished_at` on
done/failed only.

Tests run:
- `pnpm test:db tests/db/workflow-run-job.test.ts tests/db/jobs.test.ts` -> 20/20 passed.
- `pnpm test tests/unit/jobs-runner.test.ts` -> 45/45 passed.
- `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` -> clean.

Tests not run and why: none skipped from ACCEPT list.

Limitations / honesty label: none (no UI).

Security / integration risks: none found. No raw SQL text thrown; ports
errors stay the 4 fixed codes. "Metric rpc failure" and "cycle" cases use
a hand-built service-role run row (real runs never reach that shape) to
exercise the failure paths, per the packet's own test note.

Follow-ups: none new.

New dependencies (justification): none.

Assumptions made: none required; handler matches rulings "Handler" block
verbatim.
