Packet: X04-T11 Acceptance over HTTP

Files changed: tests/db/fee-plans-acceptance.test.ts (new).

Behavior implemented: real POST/GET route handlers (not direct fn calls), pattern of finance-completion-acceptance.test.ts. Test 1: accountant sets flat late-fee rule (200), admin forbidden (403); instalments.set sum mismatch -> 422 validation_failed with fieldErrors.parts, correct 3-part plan on invoice due 10 days ago -> 200; enqueue_due_late_fees + real lateFees handler on the fixture job -> one 200 charge; guardian GET feePlans.instalments -> part 1 overdue + 1 late-fee row, another family's invoice -> null; accountant pays part 1 via finance.payment.record -> part 1 paid, finance.listDefaulters drops the invoice; feePlans.ledgerExport CSV (tally, include=all) has Receipt + Journal rows incl. "Late Fee Income" ledger name. Test 2: fee_plans module off (dedicated slug, MOD mechanism) -> instalments.set 403 forbidden, re-enabled -> 200.

Tests run: `pnpm test:db tests/db/fee-plans-acceptance.test.ts` -> 2/2 pass. `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched tests/unit/mastery-schemas.test.ts). `pnpm typecheck` -> clean.

Tests not run and why: full test:db/test:security suites (non-DB-owner; packet scopes to this one new file).

Limitations / honesty label: none added (test-only packet).

Security / integration risks: none — no shared registry touched, test-only file. Needed next/headers + next/cache mocks (revalidatePath throws "static generation store missing" outside a real Next request) matching the sibling acceptance files' own pattern, not called out explicitly in the packet's READ list but required to make the actions callable.

Follow-ups: none new.

New dependencies: none (papaparse already used by finance-completion-acceptance.test.ts).

Assumptions made: validation_failed HTTP status is 422 (api-envelope.ts), not 400 as a first guess — corrected against src/lib/http/api-envelope.ts. Found T1-T10 already fully landed in the tree (only an unrelated interrupted T7 leftover, untouched by me) so T11 proceeded directly.
