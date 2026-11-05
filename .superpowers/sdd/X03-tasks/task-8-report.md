Packet: X03-T8 Seed section `library`

Files changed:
- `scripts/seed/sections/library.ts` (new)
- `scripts/seed/index.ts` (registered last, after website)
- `tests/db/seed-library.test.ts` (new, 7 tests)

Behavior implemented: 120 books (Premchand/Devanagari, Ruskin Bond, R. K. Narayan incl. "Malgudi Days", Sudha Murty, A. P. J. Abdul Kalam incl. "Wings of Fire", Panchatantra, Amar Chitra Katha, NCERT, GK; 12 Devanagari = 10%, 60 with ISBN), 240 copies (`LIB-0001`... insertion order, 3 withdrawn, all in the Premchand run); 125 loans: 45 open (35 students/10 staff, 10 overdue 1-20d), 80 returned on/before due with fine 0. No fines, no invoice/ledger writes. Named: Aarav (VI-A) open due today+5; Ananya (X-A, = `student.one`) open 6 days overdue; `teacher.x-a` one open loan. Ids: books/copies deterministic (`uuidV5`); loans keep `gen_random_uuid()` default (dates are real "today" in Asia/Kolkata, same rule as the RPCs).

Tests run:
- `DEMO_RESET_ALLOWED=true pnpm demo:reset` → seed complete, `library: 50ms`
- `pnpm test:db tests/db/seed-library.test.ts` → 7 passed
- `pnpm test:db tests/db/seed-determinism.test.ts tests/db/seed-modules.test.ts` → 3 passed
- `pnpm lint && pnpm typecheck` → clean

Tests not run and why: none; all ACCEPT commands run above.

Limitations / honesty label: none; no UI this milestone, nothing simulated.

Security / integration risks: none new; direct `insertBatch` writes (service-role key bypasses RLS, same pattern as every other seed section) — `library_loans` has no INSERT policy for `authenticated` by design, only the RPCs.

Follow-ups: none for this task; T9 (HTTP acceptance) and T10 (docs) are next in the milestone.

New dependencies: none.
Assumptions made: `SEED_SCALE` not forced to `small` for this verification run (`pnpm demo:reset` defaults to `full`); the section's fixed counts (120/240/125) are scale-independent by design, so this doesn't affect the contract. Borrower/copy selection uses deterministic stride-picks over already-seeded pools (no shared PRNG draw) since only book/copy ids are in the determinism contract.
