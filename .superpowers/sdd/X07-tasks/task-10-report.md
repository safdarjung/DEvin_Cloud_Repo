Packet: X07-T10 Acceptance over HTTP

Files changed: `tests/db/visitors-acceptance.test.ts` (new, 2 tests). T4-T8 deps now landed.

Behavior implemented: HTTP flow via `/api/v1/actions`/`/api/v1/query`: admin checkIn (bad idLast4 -> 422 validation_failed; valid -> 200), onSite list, checkOut (gone from onSite; second checkOut -> 409 invalid_state); G1 pickup.add for own child -> 200, for G2's child -> 403; class teacher gatePass.create w/ G1's pickup person -> pending; admin setStatus approved -> runOnceCore job runner -> `notifications` row (sql) recipient = G1; setStatus exited -> 200; second open pass for same student -> 409 conflict fieldErrors.studentId; G1 pickupList(A) masked phones, pickupList(B) empty. 2nd test: fresh institution, direct-SQL module toggle (MOD's mechanism, finance-completion-acceptance.test.ts precedent, avoids core.module.set/getTenantContext cache staleness) -> checkIn+list 403 MODULE_DISABLED_MESSAGE; re-enable -> 200.

Tests run: `pnpm test:db tests/db/visitors-acceptance.test.ts` -> 2/2 pass; `pnpm lint tests/db/visitors-acceptance.test.ts` clean.

Tests not run and why: full `pnpm typecheck` run has a pre-existing unrelated error in forecasts (M21, other lane's concurrent in-progress file, not touched by me); no error in my file.

Limitations / honesty label: n/a (no UI/honesty surface in this packet).

Security / integration risks: none introduced; test-only file.

Follow-ups: none for T10. Noted for controller: `src/modules/core/schemas.ts`'s `SetModuleEnabledSchema.key` enum (core.module.set) is missing `"visitors"` (and likely other recent optional keys) — not fixed here, out of my FILES scope; worth a debt row.

New dependencies: none.

Assumptions made: used direct-SQL module toggle instead of `core.module.set` action per finance-completion-acceptance.test.ts precedent (same gap above); G1/G2 family setup mirrors operations-acceptance.test.ts's `addGuardianWithChild`.
