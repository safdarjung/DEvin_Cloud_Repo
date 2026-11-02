# M13 review findings

## HIGH — `app.guard_transport_capacity()` double-counts the moving student's own row on an upsert

File: `supabase/migrations/20261028000075_operations.sql`

`app.guard_transport_capacity()` excludes the current row from its occupancy
count via `id is distinct from new.id`. `assignTransport()`
(`src/modules/transport/actions.ts`) calls
`.upsert(..., { onConflict: 'student_id' })`, which Postgres executes as
`INSERT ... ON CONFLICT (student_id) DO UPDATE`. Postgres always fires the
`BEFORE INSERT` trigger first for the speculative row (with a freshly
generated `id`, before the conflict is resolved into an `UPDATE` on the real
existing row). Because the speculative row's `id` differs from the student's
own existing assignment row, that existing row is wrongly counted as
"another" occupant, inflating the count by 1.

Net effect: reassigning a student who is already on a route that is at/near
vehicle capacity to a different stop on the SAME route (the exact scenario
named in the M13 spec — "moving a student to the other stop keeps one row")
incorrectly raises `code:conflict` "route is full", even though headcount
does not change.

Fix applied: exclude by the stable natural key instead of the per-row id —
`where route_id = new.route_id and student_id is distinct from new.student_id`.

## MEDIUM — existing "move" test doesn't exercise the capacity boundary

File: `tests/db/transport-actions.test.ts`

The "moving a student to the other stop on the same route keeps one row"
test uses `setupRouteWithCapacity(inst, 5)` with only one student assigned,
so it never exercises the at/near-capacity boundary and passes despite the
double-count bug in `app.guard_transport_capacity` described above.

Fix applied: added a test that moves a student between stops on a route
that is exactly at capacity (`setupRouteWithCapacity(inst, 1)`, one student),
which fails on the buggy trigger and passes once fixed.

## LOW

None recorded for this review.

## Outcomes

- HIGH (`guard_transport_capacity`): **fixed**. `supabase/migrations/20261028000075_operations.sql`
  count predicate changed to `route_id = new.route_id and student_id is
  distinct from new.student_id`. RED/GREEN verified: new test fails against
  the unpatched trigger (`db:reset` + buggy SQL →
  `moving a student to the other stop on a route exactly at capacity still
  succeeds` fails with `expected false to be true`), passes after the fix.
- MEDIUM (missing boundary test): **fixed**. Added
  `tests/db/transport-actions.test.ts` →
  "moving a student to the other stop on a route exactly at capacity still
  succeeds" (`setupRouteWithCapacity(inst, 1)`, one student, move between
  stops on the same route).
- Test run after fix (`pnpm db:reset` then):
  - `pnpm test:db tests/db/transport-actions.test.ts tests/db/transport-queries.test.ts tests/db/facilities-actions.test.ts tests/db/facilities-queries.test.ts tests/db/calendar-actions.test.ts tests/db/calendar-queries.test.ts tests/db/operations-rls.test.ts tests/db/operations-acceptance.test.ts tests/db/seed-operations.test.ts`
    → 9 files, 52 tests, all passed.
  - `pnpm test tests/unit/transport-schemas.test.ts tests/unit/facilities-calendar-schemas.test.ts tests/unit/fabric-fixtures/operations.test.ts`
    → 3 files, 116 tests, all passed.
- No git state changes made (per lane instructions); migration 0075 and the
  test file were edited in place only.
