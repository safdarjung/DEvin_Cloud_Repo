Packet: X06-T9 Acceptance over HTTP

Files changed: `tests/db/exam-seating-acceptance.test.ts` (new)

Behavior implemented: real HTTP dispatch (`actionsPost`/`queryGet`, bearer tokens, no supabase mock). Test 1 (one institution): exam_controller generate with 1 undersized room → 409 conflict, no plan row; generate with 2 rooms (two-grade slot, 6 students) → 200 v1; `examSeating.slots` shows plan `stale:false`; regenerate → v2; `chartHtml?format=html` → 200 text/html with both room names; `admitCardsHtml?format=html` → 3 cards for sectionA; guardian `studentSeats` own child → v2 seat, other child → `[]`; teacher generate → 403; past slot → 409 `invalid_state`. Test 2: separate institution with `exam_seating` off → generate → 403 `forbidden` / `MODULE_DISABLED_MESSAGE`.

Tests run: `pnpm test:db tests/db/exam-seating-acceptance.test.ts` → 2/2 pass. `pnpm lint` clean. `pnpm typecheck` 0 errors.

Tests not run and why: full `test:db`/`test:security` — not DB owner for this task, single-file rule.

Limitations / honesty label: n/a (acceptance test only; no app code touched).

Security / integration risks: none new — exercises existing RLS/RPC/module-gate boundaries from T2/T3/T5/T8 end to end; no bypass found.

Follow-ups: none.

New dependencies: none.

Assumptions made: generator's check order (now≥slot_start before "no paper at slot") lets the past-slot case reuse the existing exam/rooms without a matching paper at `PAST_SLOT`, per the rulings order.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
