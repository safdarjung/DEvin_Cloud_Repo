Packet: T-002 Migration 0090 — visitor_entries, pickup_persons, gate_passes (X07-T2)

Files changed:
- `supabase/migrations/20261028000090_visitors.sql` (new): 3 tables, 2 helpers (`app.my_class_teacher_student_ids`, `app.my_guardian_student_ids`), 4 guards/definers (`guard_visitor_entries`, `gate_pass_before_insert`, `guard_gate_passes_update`, `enqueue_gate_pass_notice`), RLS per rulings, `app.module_catalog` row for `visitors`
- `tests/db/visitors-rls.test.ts` (new, 11 tests)
- `tests/security/rls-expectations.ts` (+3 entries), `tests/security/grants.test.ts` (+2 helper names — shared allowlist, append only)
- `src/lib/db/types.ts` (raw `pnpm db:types`)

Behavior implemented: full ruling spec — id validation, checked-in-by/checked-in-at forced server-side for real users (service-role/postgres bypass for seed), 180-day retention delete, pickup person write scoped to guardian/M, gate pass collector snapshot + validation_failed on unauthorised collector, status state machine, one-open-pass unique index, approval job enqueue, FK set-null cascade preserved as the one legal non-status update.

Tests run: `pnpm db:reset` ok; `pnpm test:db tests/db/visitors-rls.test.ts` → 11/11 pass; `pnpm test:db tests/db/module-enabled-sql.test.ts` → 8/8 pass (drift green, T1+T2 together); `pnpm test:security` → 2236/2236 pass; `pnpm lint` clean; `pnpm typecheck` clean.

Tests not run and why: T4–T10 action/query/notification/seed/acceptance tests — out of scope, depend on this migration.

Limitations / honesty label: none new; DPDP retention/ID masking enforced at DB layer only (UI badge is Workstream D).

Security / integration risks: none found; cross-institution FK binds and collector authorisation verified in tests.

Follow-ups: T4–T8 build actions/queries/notification on this; T9 seed; T10 acceptance; T11 docs.

New dependencies: none.

Assumptions made: `pickup_persons.created_by` and `gate_passes.requested_by` use `default app.current_user_id()` / trigger-forcing (not in rulings text explicitly) to let a real-user INSERT omit them while still satisfying the RLS with-check equality — matches existing `maintenance_requests.raised_by` precedent (0075).
