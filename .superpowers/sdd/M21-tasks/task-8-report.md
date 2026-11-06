Packet: M21-T8 Runner sweep port `enqueueDueForecasts`

Files changed: `src/modules/jobs/runner.ts`, `tests/unit/jobs-runner.test.ts`

Behavior implemented: Added `enqueueDueForecasts(): Promise<void>` to `RunnerPorts` interface. Implemented in `createRunnerPorts` to call `admin.rpc("enqueue_due_forecasts")`. Integrated into `runOnceCore` right after `enqueueDueReports()` in its own try/catch with correlation id logging, never blocking the claim loop.

Tests run:
- `pnpm test tests/unit/jobs-runner.test.ts` → 37 passed
- `pnpm test:db tests/db/jobs.test.ts tests/db/announcements-acceptance.test.ts tests/db/invoice-generation.test.ts` → 25 passed
- `pnpm lint` → clean
- `pnpm typecheck` → clean

Tests not run and why: All targeted tests ran per task spec. No limitation on DB test scope.

Limitations / honesty label: None; mirrors M15-T8 pattern exactly. Feature gates at SQL level via `enqueue_due_forecasts`.

Security / integration risks: None. RPC call mirrors `enqueueDueReports` (same ports pattern); error handling prevents blocking; no new schema. Service-role RPC requires `public.enqueue_due_forecasts` to exist (T3 creates it with proper grants/policy).

Follow-ups: None (depends on T3 SQL function).

New dependencies: none

Assumptions made: `public.enqueue_due_forecasts` RPC exists and is callable by service_role (T3 responsibility). Logging correlation IDs for both sweeps now; both are non-blocking.
