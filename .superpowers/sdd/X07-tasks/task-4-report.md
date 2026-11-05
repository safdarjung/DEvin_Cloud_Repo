Packet: X07-T4 Visitor log actions

Files changed:
- `src/modules/visitors/actions.ts` (new): checkInVisitor, checkOutVisitor, purgeVisitors
- `tests/db/visitors-actions.test.ts` (new, 3 tests)
- `src/app/api/v1/actions/all-actions.ts` (+1 import, append)
- `tests/security/escalation.test.ts` (+3 fixtures: visitors.checkIn/checkOut/purge, append)

Behavior implemented: `visitor.manage`-gated checkIn (insert, id masked to type+last4, 42501 on cross-institution hostStaffId -> forbidden), checkOut (one UPDATE, trigger forces checked_out_at/by, double checkout -> invalid_state via mapSqlError), purge (delete relies on `visitor_entries_delete` RLS 180-day window, returns {deleted} count). Audit action strings use snake_case (visitors.check_in/check_out) per curriculum.actions.ts precedent — registry name stays camelCase.

Tests run:
- `pnpm test:db tests/db/visitors-actions.test.ts` -> 3/3 pass
- `pnpm test tests/unit/action-names-unique.test.ts` -> 6/6 pass
- `pnpm test:security tests/security/escalation.test.ts` -> 1132/1132 pass
- `pnpm lint` (touched files) -> clean
- `pnpm typecheck` -> clean for my files; pre-existing errors in `gate-pass.actions.ts` and `forecasts-queries.test.ts` (other packets, untouched) unrelated

Tests not run and why: full `pnpm test:db` (non-owner restriction, brief).

Limitations / honesty label: none new; retention/masking enforced at DB (T2), not duplicated here.

Security / integration risks: none found; RLS 42501 -> forbidden mapped, 0-row update -> not_found, no PII in audit payload (verified in test).

Follow-ups: none for T4 itself.

New dependencies: none.

Assumptions made: cross-institution test needed a 20s `it` timeout (two 9-role fixture institutions under concurrent-lane DB load exceed vitest's 5s default) — added only to that test, not global config.
