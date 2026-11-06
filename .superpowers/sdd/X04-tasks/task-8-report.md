Packet: X04-T8 Job `fee_plans.late_fees` + runner sweep

Files changed: src/modules/jobs/handlers/fee_plans.late_fees.ts (new); src/modules/jobs/handlers/index.ts; src/modules/jobs/registry.ts (JOB_REGISTRY + JOB_MODULES row); src/modules/jobs/types.ts (JobType); src/modules/jobs/runner.ts (RunnerPorts.enqueueDueLateFees, wired into runOnceCore before claim loop); tests/unit/jobs-runner.test.ts (+6: fakePorts field, 2 sweep-ordering/rejection cases, 2 port RPC cases already counted, 1); tests/db/fee-plans-late-fees-job.test.ts (new).

Behavior implemented: `lateFees` handler calls `apply_late_fees` RPC for `job.institution_id`, throws `fee_plans.late_fees: <sql_code>` only (no payload/PII) on error. `enqueueDueLateFees` port calls `enqueue_due_late_fees` RPC; `runOnceCore` sweeps it once before the claim loop in its own try/catch, logs `[<correlationId>] late-fee sweep failed` on rejection, never blocks claiming. JOB_MODULES gates `fee_plans.late_fees` -> `fee_plans` (existing MOD-T11 gate, no new logic).

Tests run: `pnpm test tests/unit/jobs-runner.test.ts` -> 37/37 pass. `pnpm test:db tests/db/fee-plans-late-fees-job.test.ts` -> 3/3 pass (direct-handler charge+idempotent-rerun, no-institution_id throw, sweep->job->handler end-to-end + module-off enqueues none). `pnpm test:db tests/db/jobs.test.ts` -> first run 10/11 (C-70 concurrency flaked: claimed 2 not 1); reproduced identically with my sweep call stubbed out (`if (false)`), so pre-existing/environmental, not caused by this change; reverted stub, reran clean -> 11/11. `pnpm lint` -> 0 errors (8 pre-existing warnings in untouched mastery-schemas.test.ts). `pnpm typecheck` -> clean.

Tests not run and why: full test:db/test:security suites (packet scope + other lanes' concurrent edits in this tree).

Limitations / honesty label: none (no UI).

Security / integration risks: running `tests/db/jobs.test.ts` (real unscoped `runOnceCore`) exercised the live sweep against the demo tenant, which genuinely had an overdue instalment invoice (T10 seed) — it applied one real ₹200 late fee to that demo invoice via `apply_late_fees`/`add_invoice_charge`. This is the feature working as designed, not corruption, but it is a real mutation of seed data left in this lane's DB; flagging per CLAUDE.md rule 11 (demo data is a contract) in case T9/T11/E2E authors need a clean baseline (no demo:reset run by me — out of scope for a non-DB-owner task).

Follow-ups: none new.

New dependencies: none.

Assumptions made: `error.code` (not `.message`) is the right "SQL code only" per EXPORTS wording; JOB_MODULES/registry edits done as Edit-only append per shared-file rule.
