Packet: X04-T9 Defaulters + fee reminders respect instalments

Files changed: src/modules/finance/queries.ts (listDefaulters: +onPlan field, drops plan invoices with no overdue part via invoice_instalment_status paged, dueOn = earliest unpaid part); src/modules/jobs/handlers/finance.fee_reminder.ts (same RPC/filter, service role); tests/db/fee-plans-defaulters.test.ts (new).

Behaviour implemented: both reads call rpc("invoice_instalment_status", {p_institution_id, p_term_id}) paged with .range(1000), build invoice_id->parts map; a plan invoice (present in map) with no overdue part is excluded/skipped; dueOn/reminder amount use existing fields otherwise. No module-flag check added anywhere (ruling: plans shape defaulters/reminders even with fee_plans off) — tested explicitly.

Tests run: pnpm test:db tests/db/fee-plans-defaulters.test.ts -> 4/4 pass; tests/db/fee-reminders.test.ts tests/db/finance.test.ts -> 18/18 pass; pnpm lint -> 0 errors (8 pre-existing warnings in untouched tests/unit/mastery-schemas.test.ts); pnpm typecheck -> clean.

Tests not run and why: full test:security/test:db not run (non-DB-owner; packet scopes to the 3 files above).

Limitations / honesty label: none (no UI; backend only).

Security / integration risks: none — no shared registry file touched, no RLS/migration change, reuses T2's RPC exactly as T4 and the rulings describe it.

Follow-ups: none new.

New dependencies: none.

Assumptions made: "earliest unpaid part" = first part (by seq) whose status != 'paid' (covers overdue/part_paid/due), per ruling wording; test dates fixed relative to real system clock (2026-11-05), matching sibling X04 test files' convention.
