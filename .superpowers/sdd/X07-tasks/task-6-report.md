Packet: X07-T6 Pickup list actions

Files changed:
- `src/modules/visitors/pickup.actions.ts` (new): addPickupPerson, removePickupPerson
- `tests/db/pickup-actions.test.ts` (new, 8 tests)
- `src/app/api/v1/actions/all-actions.ts` (+1 import line, append)
- `tests/security/escalation.test.ts` (+2 FIXTURES entries, append)

Behavior implemented: `visitors.pickup.add` (pickup.manage) inserts into pickup_persons, created_by left to DB default (app.current_user_id()); 23505 pickup_persons_student_phone_key -> conflict/fieldErrors.phone, 42501 -> forbidden. `visitors.pickup.remove` hard-deletes by id scoped to institution; 0 rows -> not_found.

Tests run:
- `pnpm test:db tests/db/pickup-actions.test.ts` -> 8/8 pass
- `pnpm lint` -> clean
- `pnpm typecheck` -> 3 pre-existing errors, all in visitors/actions.ts + gate-pass.actions.ts (T4/T5, not my files, not touched)
- `pnpm test tests/unit/action-names-unique.test.ts` -> my 2 action names present/matched; 2 failures are T5 gatePass + T8 query names not yet registered (concurrent lanes)
- `pnpm test:security tests/security/escalation.test.ts` -> my 2 fixtures pass; 21 failures all `visitors.gatePass.*` (T5 fixtures missing, concurrent)

Tests not run and why: full test:security/db suites — non-owner, brief forbids.

Limitations / honesty label: none new.

Security / integration risks: none found; permission gate (pickup.manage) blocks teacher/student before handler; RLS backs guardian-scope at DB layer (verified in test).

Follow-ups: none for T6. Controller: T5/T8 registry entries still pending at time of this report.

New dependencies: none.

Assumptions made: created_by/guardian-link test fixtures built via raw SQL (guardian_students insert) since createTestInstitution leaves guardian unlinked by default.
