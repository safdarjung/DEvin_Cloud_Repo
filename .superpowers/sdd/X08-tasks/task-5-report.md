Packet: X08-T5 PTM actions
Files changed: src/modules/ptm/actions.ts (new); tests/db/ptm-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+6 C-03 fixtures)
Behavior implemented: createPtmEvent (draft+sections, rolls back draft and maps 42501->forbidden on cross-institution section, eventDate>=today IST), publishPtmEvent (plain update, guard trigger enforces transition), addPtmSlots (own staffId default, another staffId needs ptm.manage, computes whole-fit seqs for [from,to), upsert ignoreDuplicates), removePtmSlot (delete, 0 rows->not_found, guard maps conflict), bookPtmSlot/cancelPtmBooking (thin RPC wrappers, audited in SQL already so no action-level audit duplicate).
Tests run: `pnpm test:db tests/db/ptm-actions.test.ts` -> 1 file, 8 passed. `pnpm test tests/unit/action-names-unique.test.ts` -> 1 file, 6 passed. `pnpm test:security tests/security/escalation.test.ts` -> 1 file, 1222 passed. `pnpm lint` clean (2 warnings, pre-existing in tests/db/survey-queries.test.ts, not mine). `pnpm typecheck` clean.
Tests not run and why: full `pnpm test:db`/`pnpm test:security` — other lanes editing concurrently, brief restricts to single-file runs; no db:reset/seed/db:types run (not DB owner this task).
Limitations / honesty label: none new (X08 honesty label is T11's job).
Security / integration risks: none identified. Permission-escalation path (addPtmSlots staffId override) gated before any DB call; cross-tenant section insert rolls back the draft event before returning.
Follow-ups: none for T5 itself; T6/T9 consume these actions.
New dependencies (justification): none.
Assumptions made: bookingClosesAt in the escalation fixture needed `:00` seconds (zod v4 `.datetime({offset:true})` requires seconds even though the rulings/seed prose write `HH:MM+05:30` for raw SQL inserts) — matches T4's own schema test fixtures.
