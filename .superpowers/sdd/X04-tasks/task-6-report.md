Packet: X04-T6 Queries `feePlans.lateFeeRules`, `feePlans.instalments`

Files changed: src/modules/fee-plans/queries.ts (new); src/modules/fee-plans/query-defs.ts (new); tests/db/fee-plans-queries.test.ts (new); src/app/api/v1/query/all-queries.ts (+1 import); tests/db/api-query-route.test.ts (+2 smoke samples).

Behavior implemented: listLateFeeRules(ctx) — every fee_structures row of the current academic_year, left-joined (2 queries, not a PostgREST embed) against late_fee_rules, rule or null; getInstalments(ctx, {invoiceId}) — invoice visibility via plain select+RLS (null if not visible), parts from public.invoice_instalment_status rpc, lateFees from late_fee_charges table, both money fields round-tripped through finance/queries.ts's moneyToPaise/paiseToMoney (reused, not duplicated). query-defs.ts wraps both via defineQuery, reusing T3's LateFeeRulesQuerySchema/InstalmentsQuerySchema as-is; feePlans.lateFeeRules -> finance.structure.manage, feePlans.instalments -> finance.read, both module: "fee_plans".

Tests run: `pnpm test:db tests/db/fee-plans-queries.test.ts tests/db/api-query-route.test.ts` -> 9/9 pass (accountant lists 2 structures one ruled/one not + teacher forbidden; guardian reads own child's 2-part plan with derived overdue/due statuses + 1 seeded late-fee row; another family's invoice -> null; no-plan invoice -> parts:[]; owner smoke covers both new query names). `pnpm lint` -> 0 errors (8 pre-existing warnings, untouched mastery-schemas.test.ts). `pnpm typecheck` -> clean.

Tests not run and why: full test:db/test:security suites not run (packet scopes to the 2 files above per BRIEF-COMMON; other lanes' concurrent T5/T8/T9 files in this tree untouched and unread).

Limitations / honesty label: none for T6 (no UI; reads only).

Security / integration risks: none — only Edit (append) on the two shared registries (all-queries.ts, api-query-route.test.ts), both re-read immediately before editing; no permission/RLS change (T1/T2 already landed finance.structure.manage/finance.read/fee_plans module).

Follow-ups: none new.

New dependencies: none.

Assumptions made: late_fee_rules<->fee_structures embedded via two sequential selects + a Map, not a PostgREST `fee_structures(...late_fee_rules(...))` embed, since the forward FK's uniqueness makes the embed shape (object vs array) ambiguous — matches no existing precedent in this codebase, so the safer two-query join was used (same cost, same RLS).
