# X07 security review — findings and fixes

Reviewer is read-only on this file in its original pass; this copy records
findings before fix work starts, then outcomes are appended per item.

## Findings

### HIGH — `src/modules/core/schemas.ts`: `SetModuleEnabledSchema.key` missing `"visitors"`
`SetModuleEnabledSchema.key` enum (used by the `core.module.set` action) does
not include `"visitors"`. Since the visitors module defaults to off
(`app.module_catalog.default_enabled = false`, X07 rulings), there is no
supported production path for an owner/principal/admin to turn this feature
on for a real school — the action rejects `{key:"visitors"}` with
`validation_failed` before reaching the DB. Only the seed (`allModulesOn()`)
and the acceptance test's direct-SQL settings patch bypass this. Flagged but
left unfixed by the X07-T10 agent (`task-10-report.md`) as out of scope.
Fix: add `"visitors"` to the enum.

### MEDIUM — `supabase/migrations/20261028000090_visitors.sql`: `pickup_persons_select` exposes raw phone to multiple roles
The `pickup_persons_select` RLS policy grants owner/principal/admin, the
student's class teacher, and the student's linked guardian direct SELECT
access to the raw, unmasked `phone` column. Phone masking (`"******1234"`)
is implemented only in `src/modules/visitors/queries.ts`'s `maskPhone()`,
i.e. only for callers that go through the `visitors.pickupList` query route
— any of those same roles calling the Supabase REST/PostgREST endpoint
directly with their own JWT (same access RLS already permits) get the full
phone number. The DPDP masking guarantee in the rulings/docs therefore only
holds for one access path, not for the table itself.

### LOW — `src/modules/visitors/actions.ts` / `src/modules/visitors/pickup.actions.ts`: missing 23503 handling
`checkInVisitor` (and similarly `pickup.actions.ts`'s `addPickupPerson`)
never special-case Postgres `23503` (foreign-key violation) the way
`gate-pass.actions.ts` does, even though the X07 ruling's ErrorCode mapping
table says `23503 -> not_found`. If a FK violation were ever to reach this
code (today it's pre-empted by the RLS `WITH CHECK exists()` clauses, which
fail as `42501` first), it falls through `mapSqlError`'s default branch and
returns a generic internal error instead of `not_found`. Add the same
`POSTGRES_FOREIGN_KEY_VIOLATION` handling used in `gate-pass.actions.ts` for
consistency/robustness.

### LOW — `supabase/migrations/20261028000090_visitors.sql`: `app.guard_gate_passes_update` early-return branch too broad
The early-return branch (allowing `pickup_person_id` to go to null with
every other column unchanged) matches any UPDATE with that exact shape, not
only the FK's own `ON DELETE SET NULL` cascade from a guardian removing a
pickup person. A teacher or admin could issue that same UPDATE directly on
an active (pending/approved) pass, bypassing the intended "only a cascade
clears this" guarantee — not a privilege escalation or data leak, just
narrower immutability than documented.

### LOW — `docs/planning/coolskool/05-data-architecture.md`: §2.12 wording implies a CHECK constraint that doesn't exist
§2.12 `gate_passes` row lists "check exactly one of guardian_id/pickup_person_id"
under "Constraints / indexes", implying a DB CHECK constraint, but this rule
is actually enforced only by the `app.gate_pass_before_insert` trigger
(raises `code:validation_failed`), not a table-level CHECK — minor wording
that could mislead someone auditing DB-level constraints directly.

## Outcomes

(appended after fixes)
