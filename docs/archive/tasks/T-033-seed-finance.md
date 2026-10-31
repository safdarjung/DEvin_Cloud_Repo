# T-033 — Seed finance (structures, invoices ≈70% paid)

| Field | Value |
|---|---|
| Lane / Day | C / Day 10 |
| Size | 0.5 agent-days |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-FIN-01..F-FIN-07, F-IDN-06 |
| Depends on | T-030 (merged), T-013 (merged), T-012 (merged) |
| Migration | — |

## Business outcome
The demo tenant has realistic fee data: every student has a structure and two term invoices, about 70% paid with receipts and a balanced ledger, so finance screens, the guardian portal, and the dashboard show credible numbers without manual entry.

## Current repo state (verify before starting)
- Seed framework: `ls scripts/seed/index.ts scripts/seed/sections/ scripts/seed/context.ts`.
- Earlier sections export ids: `grep -n "export" scripts/seed/sections/academics.ts | head`.
- PRNG helper: `grep -n "mulberry32\|uuidV5" scripts/seed/lib/*.ts`.

## Spec sections to read (only these)
`05-data-architecture.md §8` · `05 §2.6` · `06-workflows-and-contracts.md §W9` (generation and payment rules) · `12-decision-log.md §2` (domain row: fee heads, Tier 2/3 ranges) · `08 §3 C-51..C-53`.

## Files to inspect first
`scripts/seed/sections/academics.ts` (how grades/enrolments are exposed on `SeedContext`) · `scripts/seed/sections/core.ts` (terms, FY) · `scripts/seed/lib/db.ts` (batch insert and RPC helpers).

## Expected changes
- `scripts/seed/sections/finance.ts` — new section:
  - one `fee_structures` row per grade for `2026-27` with components: `tuition` (monthly; ₹2,200 I–V, ₹2,600 VI–VIII, ₹3,000 IX–X, ₹3,400 XI–XII), `annual_charges` (annual ₹6,000), `transport` (monthly ₹1,500, assigned to ≈40% of students), `exam` (term ₹500), `lab_computer` (term ₹600 from VI), `activity` (annual ₹1,200);
  - `fee_assignments` for every active enrolment; concessions on ≈8% of students deterministically chosen (sibling 15% on tuition, staff_ward 50% on tuition, ews_rte 100% on all heads), `approved_by` = principal user;
  - invoices for Term 1 and Term 2 via `app.generate_invoice` (service-role RPC), batched;
  - payments: Term 1 ≈85% paid in full, Term 2 ≈55% paid (full or half), modes weighted cash 50 / upi 35 / neft 10 / cheque 5, `received_at` spread over the term, via `app.record_payment` with key `seed:pay:<invoice_no>:<n>`;
  - assertions at the end: 6,048 invoices, ≈70% ± 2% of invoice amount collected, ledger balanced.
- `scripts/seed/index.ts` — the lead adds `finance` after `admissions`; this packet proposes the line in the report.
- `tests/db/seed-finance.test.ts` — reads counts from the seeded demo tenant (run after `pnpm seed`).

## Must not modify
`scripts/seed/sections/{core,people,academics,attendance,admissions,exams,website}.ts` · `scripts/seed/index.ts` (propose only) · migrations.

## Permissions / nav / migration numbers needed from the lead
Seed order line in `scripts/seed/index.ts`.

## Security and data-integrity requirements
- Only the service-role client with `SERVICE_ROLE_CALLER=seed`; writes go through the two SQL functions so triggers, sequences, and ledger logic are exercised, never bypassed.
- Determinism: all choices from the shared PRNG; no `Date.now()`; receipt numbers therefore identical across resets.
- Transport only for students flagged `details.transport = true` in the people section (if absent, derive deterministically and record).

## Acceptance criteria
1. `pnpm demo:reset` completes; finance section < 60 s (time recorded).
2. Counts: 12 structures, 3,024 assignments, ≈242 concessions, 6,048 invoices, receipts = payments, `invoice_no`/`receipt_no` gap-free.
3. Dashboard-level totals reproducible run-to-run (same collected sum).
4. `guardian.one`'s children have one paid and one part-paid invoice (chosen deterministically for the demo script).

## Demo-data contract (from `05 §8.1`, mandatory)
- `INV-T2-Aarav`: Aarav Sharma's Term 2 invoice issued 2026-10-01, due 2026-10-10, unpaid (the demo records the payment live); Ananya's and Ishaan's Term 2 invoices paid.
- ≈70% of all invoices paid with deterministic modes/dates; receipt numbers gap-free per FY `2026-27`; counts match `05 §8.2`.

## Tests (write failing tests first) and exact commands
- `tests/db/seed-finance.test.ts` (counts, balance, determinism across two runs) → `pnpm seed && pnpm test:db -- tests/db/seed-finance.test.ts`
- Re-run C-51..C-53 → `pnpm test:db -- tests/db/finance.test.ts`

## Deliverables
Section file, proposed index line, test, timing in report.

## Assumptions and risks
- 6,048 RPC calls may be slow: batch via a thin `app.seed_generate_invoices(term_id)` only if measured > 60 s (new migration number required from the lead — request, do not create).

## Completion report
Use the format in `CLAUDE.md`.
