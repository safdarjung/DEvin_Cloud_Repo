# T-031 — Fee structures, assignments, term invoice generation (job)

| Field | Value |
|---|---|
| Lane / Day | C / Day 7–8 |
| Size | 1.5 agent-days |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-FIN-01, F-FIN-02, F-FIN-03 |
| Depends on | T-030 (merged), T-013 (merged); T-037 for the job handler wiring |
| Migration | — |

## Business outcome
The accountant configures fee structures per grade, assigns them (with concessions) to students, and generates a term's invoices for the whole school in one click; every invoice is visible with its lines.

## Current repo state (verify before starting)
- Finance tables and functions: `grep -n "function app.generate_invoice" supabase/migrations/20261028000008_finance.sql`.
- Action kit: `ls src/lib/actions/define-action.ts src/lib/actions/result.ts`.
- Tenant pages pattern: `ls src/app/\(tenant\)/\[institution\]/attendance` (or any merged module page).
- Job enqueue helper: `grep -n "enqueue_job" supabase/migrations/20261028000003_platform.sql`; runner present only if T-037 merged: `ls src/modules/jobs/runner.ts`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §1, §W9` · `05-data-architecture.md §2.6, §4.1 (finance)` · `04-architecture.md §2, §3, §7` · `07 §2` (finance rows) · `08 §2` (Finance math), `§3 C-51`.

## Files to inspect first
`src/modules/attendance/actions.ts` (defineAction usage) · `src/lib/nav.ts` · `src/components/ui/*` (shadcn components already added) · `tests/unit/permissions.test.ts` (unit style).

## Expected changes
- `src/modules/finance/schemas.ts` — `UpsertFeeStructureSchema`, `AssignFeeStructureSchema` (concessions array), `GenerateTermInvoicesSchema`.
- `src/modules/finance/actions.ts` — `upsertFeeStructure`, `assignFeeStructure`, `generateTermInvoices` (enqueues `finance.generate_term_invoices` with key `invoices:<term_id>:<grade_id|all>`; if runner absent, documents that `pnpm jobs:run` processes it later), `generateStudentInvoice` (synchronous single call to `app.generate_invoice`).
- `src/modules/finance/queries.ts` — `listFeeStructures`, `getFeeStructure`, `listInvoices({ termId, status, gradeId })`, `getInvoice`.
- `src/modules/finance/proration.ts` — pure functions: component amount due in a term, concession application, rounding (mirrors SQL for UI preview).
- `src/modules/finance/components/{FeeStructureForm,FeeAssignmentDialog,InvoiceTable,InvoiceDetail}.tsx`.
- `src/app/(tenant)/[institution]/finance/{page,structures/page,structures/[id]/page,invoices/page,invoices/[id]/page}.tsx`.
- `src/modules/jobs/handlers/finance.generate_term_invoices.ts` — loops active enrolments, calls `app.generate_invoice`, idempotent.
- `tests/unit/finance-proration.test.ts`, `tests/db/invoice-generation.test.ts`.

## Must not modify
`supabase/migrations/**` · `src/lib/auth/permissions.ts` · `src/modules/jobs/runner.ts` · `src/lib/nav.ts` (request the line instead).

## Permissions / nav / migration numbers needed from the lead
Nav: `{ href: '/finance', label: 'Finance', permission: 'finance.read' }`. Permissions already exist.

## Security and data-integrity requirements
- Actions use `finance.structure.manage` / `finance.invoice.generate`; concessions carry `approved_by = ctx.user.id`.
- Generation only through `app.generate_invoice`; no inserts into `invoices` from TypeScript.
- Zod `.strict()` on every schema; money via `money` primitive.

## Acceptance criteria
1. Accountant creates a structure for grade VI with six components; a second save updates, not duplicates.
2. Assigning a structure with a 20% sibling concession on `tuition` shows the previewed amount equal to the SQL-generated invoice line.
3. "Generate Term 2 invoices" enqueues one job; after `pnpm jobs:run` every active student has exactly one Term 2 invoice; rerun creates none.
4. Teacher receives `forbidden` from all three actions; invoice list for an accountant shows status filters working.

## Tests (write failing tests first) and exact commands
- `tests/unit/finance-proration.test.ts` (08 §2 Finance math) → `pnpm test -- tests/unit/finance-proration.test.ts`
- `tests/db/invoice-generation.test.ts`: C-51 via the action path + handler idempotency → `pnpm test:db -- tests/db/invoice-generation.test.ts`
- `pnpm test:security -- tests/security/actions.test.ts` (new actions registered → forbidden for other roles).

## Deliverables
Actions, queries, pages, components, handler, tests, nav request line, completion report.

## Assumptions and risks
- Default due date = `term.starts_on + settings.finance.default_due_day`.
- Bulk generation for 3,024 students may exceed the 50 s job budget: handler processes in grade batches and re-enqueues the remainder (documented).

## Completion report
Use the format in `CLAUDE.md`.
