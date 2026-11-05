Packet: X04-T10 Seed section `fee-plans`

Files changed: scripts/seed/sections/fee-plans.ts (new); scripts/seed/index.ts (+2 lines, registered after finance); tests/db/seed-fee-plans.test.ts (new).

Behavior implemented: late_fee_rules on every fee structure of grades I-V (per_day ₹10, grace 5, cap ₹300) and XI-XII (flat ₹250, grace 7) — 14 rows, 2 variants/grade; 3-part invoice_instalments (insertBatch, service role) on the first 24 unpaid ('issued'/'part_paid') Term 2 invoices of those grades by invoice_no: part1 = invoice due_on, part2 2026-12-10, part3 2027-02-10, principal (app.invoice_principal) split in paise, remainder on part 3. No late-fee charges written (date-dependent; runner applies them). Idempotent rerun guard matches finance.ts.

Tests run: `DEMO_RESET_ALLOWED=true pnpm demo:reset` -> clean; `pnpm test:db tests/db/seed-fee-plans.test.ts` -> 8/8 pass; `pnpm test:db tests/db/seed-determinism.test.ts tests/db/seed-finance.test.ts` -> 9/9 pass (full reseed inside, unaffected); reran seed-fee-plans.test.ts after that reseed -> 8/8 pass again; `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched mastery-schemas.test.ts); `pnpm typecheck` -> clean.

Tests not run and why: none skipped for this packet.

Limitations / honesty label: none (no UI).

Security / integration risks: none — no shared file touched (no new action/query, so permissions.ts/escalation.test.ts untouched).

Follow-ups: none new.

New dependencies: none.

Assumptions made: determinism test verifies rule/instalment ids as a pure function of (fee_structure_id) / (admission_no, seq) rather than a second full demo:reset+compare — which specific 24 admission numbers the invoice_no-ordered pick lands on is not itself guaranteed stable across reseeds (invoice_no is race-assigned by concurrent app.generate_invoice calls per finance.ts's own documented non-determinism), only that the id-derivation formula is pure; recorded here per CLAUDE.md "proceed with a recorded default."
