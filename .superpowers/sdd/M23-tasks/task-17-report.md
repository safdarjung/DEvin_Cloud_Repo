Packet: M23-T17 Queries `workflows.list`, `workflows.runs`

Files changed:
- src/modules/workflows/queries.ts (new)
- src/modules/workflows/query-defs.ts (new)
- tests/db/workflows-queries.test.ts (new)
- src/app/api/v1/query/all-queries.ts (Edit: +1 import line)
- tests/db/api-query-route.test.ts (Edit: +2 smoke samples, `{}` each)

Behavior implemented: `workflowList`/`workflowRuns` (queries.ts), exposed
as `workflows.list`/`workflows.runs` (`workflow.read`, module `workflows`).
list: institution-scoped, optional `status` filter, `created_by` hydrated
to the profile's full name (mirrors agents/queries.ts actor lookup); keys
equal `Workflow` fixture exactly. runs: newest-first (`started_at desc`),
optional `workflowId`/`status` filter, `limit`; keys equal `WorkflowRun`
fixture exactly.

Tests run (TDD red first, then green):
- `pnpm test:db tests/db/workflows-queries.test.ts` -> 7/7 passed (key
  parity, trigger shape, created_by name, status filter, admin ok/teacher
  forbidden, cross-tenant []; runs newest-first + key parity, workflowId/
  status/limit filters, teacher forbidden + cross-tenant []).
- `pnpm test:db tests/db/api-query-route.test.ts` -> 7/7 passed (smoke
  samples resolve with no "internal" error for the 2 new queries).
- `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` -> clean.

Tests not run and why: none skipped from ACCEPT list.

Limitations / honesty label: none (no UI, no AI, no simulated data).

Security / integration risks: none found. Reads only; RLS is the real
tenant filter (cross-tenant asserted empty, not just permission-gated);
no new writes, no new DB grants.

Follow-ups: none new.

New dependencies (justification): none.

Assumptions made: list order = `name` asc (rulings specify no order for
list, only for runs); created_by lookup follows `agents/queries.ts`'s
batch profiles pattern exactly (first match wins, "" if name missing).
