Packet: T-031 Fee structures, assignments, term invoice generation (job)

Files changed:
- src/modules/finance/schemas.ts (new)
- src/modules/finance/proration.ts (new)
- src/modules/finance/actions.ts (new)
- src/modules/finance/queries.ts (new)
- src/modules/finance/components/FeeStructureForm.tsx (new)
- src/modules/finance/components/FeeAssignmentDialog.tsx (new)
- src/modules/finance/components/InvoiceTable.tsx (new)
- src/modules/finance/components/InvoiceDetail.tsx (new)
- src/modules/finance/components/GenerateInvoicesPanel.tsx (new, see "deviations")
- src/app/(tenant)/[institution]/finance/page.tsx (new)
- src/app/(tenant)/[institution]/finance/structures/page.tsx (new)
- src/app/(tenant)/[institution]/finance/structures/[id]/page.tsx (new)
- src/app/(tenant)/[institution]/finance/invoices/page.tsx (new)
- src/app/(tenant)/[institution]/finance/invoices/[id]/page.tsx (new)
- src/modules/jobs/handlers/finance.generate_term_invoices.ts (new; replaces the T-037/T-038 placeholder)
- src/modules/jobs/handlers/index.ts (edit: export the real handler instead of the placeholder)
- tests/unit/finance-proration.test.ts (new)
- tests/db/invoice-generation.test.ts (new)
- tests/unit/jobs-runner.test.ts (edit: the one test asserting `finance.generate_term_invoices` was still a placeholder now points at `notify.results_published`, the one still genuinely unimplemented — not a new bug, the old assertion's premise is what T-031 was asked to fix)

Behavior implemented:
- `upsertFeeStructure`: creates/updates a fee structure + its components in one call. Components upsert by `(fee_structure_id, head)`; the structure itself upserts by `(academic_year_id, grade_id, name)` when no `id` is given, or updates by `id`. Every id (academic year, grade, structure-on-edit) is verified against `ctx.institution` first.
- `assignFeeStructure`: assigns a structure + academic year to a student, with 0+ concessions (`approved_by = ctx.user.id`). Verifies student/academic-year/structure belong to the institution, that the structure's academic year matches, and that each concession's `head` (if given) is a real component on that structure.
- `generateTermInvoices`: synchronous per-student loop over active enrolments (filtered by term's academic year + optional grade) calling `public.generate_invoice` per student. No TypeScript insert into `invoices`/`invoice_lines` anywhere.
- `generateStudentInvoice`: single-student version of the same RPC call.
- `finance.generate_term_invoices` job handler: Zod-validates `{ term_id, grade_id? }`, scopes everything to `job.institution_id` (never the payload), loops the same enrolment query via the service-role client, calls `generate_invoice` per student with a soft 40s budget, and throws (triggering the runner's normal retry) if the budget was hit or any student failed — safe because `generate_invoice` is idempotent per (student, term), so a retry/rerun never duplicates.

Tests run:
- `pnpm vitest run --project unit tests/unit/finance-proration.test.ts` → 8/8 pass.
- `pnpm test` (full unit project) → 235/235 pass.
- `pnpm vitest run --project db tests/db/invoice-generation.test.ts` → 10/10 pass (run twice; one run hit a transient "relation does not exist" because the parallel T-017 agent was mid `db:reset` on the shared local DB — retried per packet instruction once the schema was back, both retries green).
- `pnpm lint` → 0 errors (4 pre-existing warnings in `scripts/seed/sections/*`, not touched by this packet).
- `pnpm typecheck` → clean.

Actions — permission and scope proof:
- `upsertFeeStructure` / `assignFeeStructure`: `permission: "finance.structure.manage"` (src/modules/finance/actions.ts). Matches `app.finance_roles()` = owner/principal/admin/accountant (supabase/migrations/20261028000001_foundation.sql:140-147) exactly — no RLS-vs-matrix gap (rule 3: nothing to report here).
- `generateTermInvoices` / `generateStudentInvoice`: `permission: "finance.invoice.generate"`. Matrix (src/lib/auth/permissions.ts) grants this to owner/principal/accountant only — admin excluded, proven by `tests/db/invoice-generation.test.ts`'s "an admin may manage structures/assignments but is forbidden from generateTermInvoices" case. Matches `app.finance_write_roles()` (20261028000008_finance.sql:396-408), the same role set `public.generate_invoice` itself enforces — defense in depth, not a gap.
- Every action verifies every foreign id (academic year, grade, student, term, fee structure, concession head) against `ctx.institution.id` via `require*` helpers in actions.ts before writing, and maps SQL errors through `mapSqlError`/`AppError` — proven by the "every id is verified against ctx.institution" cross-tenant test (not_found, not a leak or an opaque `internal`).
- Teacher is forbidden from all three actions; accountant/owner/principal/admin matrix proven in `tests/db/invoice-generation.test.ts`.

Job handler idempotency evidence (tests/db/invoice-generation.test.ts):
- "via the real runner": enqueues a real job via `app.enqueue_job`, runs it through `runOnceCore`/`createRunnerPorts` (the actual registry wiring), then enqueues and runs a second job for the same term — invoice count stays at 2, not 4.
- "direct handler rerun": calls the handler function twice in a row with the same fabricated `JobRow` — invoice count stays at 2.
- Both rely on `public.generate_invoice`'s own idempotency (existing invoice returned, no insert) — the handler itself does no dedup bookkeeping, by design.
- "is scoped to the job row's institution_id, not the payload": a payload naming another institution's term is rejected with "term not found" — proves the handler never trusts `payload` for tenant scope, only `job.institution_id`.
- "rejects a malformed payload without echoing it": confirms the Zod validation error carries no payload content.

TS-vs-SQL proration parity test (tests/db/invoice-generation.test.ts, "AC2" describe block):
- Assigns a structure (tuition 10000 + transport 1500, both `term` frequency) with a 20% sibling concession on `tuition`, generates the real invoice via `public.generate_invoice`, and asserts `proration.ts`'s `previewInvoice(...)` output for the same inputs equals the actual `invoice_lines.amount`/`concession_amount` columns exactly (2000.00 concession on a 10000.00 line). `tests/unit/finance-proration.test.ts` separately covers the rounding-to-paise edge case (833.33 × 6 monthly proration × 33.33% concession → 1666.49, verified by hand against the SQL's `round(numeric,2)` semantics) so drift would be caught at the unit level even without a DB.

RLS-vs-matrix findings: none. `app.finance_roles()` and `app.finance_write_roles()` both match the permission matrix exactly for the rows this packet touches (checked by reading supabase/migrations/20261028000001_foundation.sql and 20261028000008_finance.sql against src/lib/auth/permissions.ts).

Nav line: already present in src/lib/nav.ts — `{ href: "/finance", label: "Finance", icon: Banknote, permission: "finance.read" }`. Not touched (file is off-limits); no change needed.

Deviations:
- `GenerateTermInvoicesSchema` uses a singular `gradeId?: uuid` (packet's own key format `invoices:<term_id>:<grade_id|all>`), not spec 06 §W9's `gradeIds?: uuid[]`. Followed the packet over the master spec per the task instructions; flagging for the lead to reconcile 06 §W9's wording.
- Added one component beyond the packet's named four (`FeeStructureForm`, `FeeAssignmentDialog`, `InvoiceTable`, `InvoiceDetail`): `GenerateInvoicesPanel.tsx`, a small client control (term/grade pickers + the "Generate Term invoices" button + result message) needed on `invoices/page.tsx` since the actual action call needs pending/result UI state. Also added three small picker queries to `queries.ts` (`listAcademicYears`, `listGradeOptions`, `listTermOptions`) beyond the four named — the structure/invoice forms need somewhere to source their dropdown options and no existing module exposes them.
- `FeeAssignmentDialog` takes a raw student UUID text input rather than a student picker — no student-search component exists in this codebase yet and building one was out of this packet's scope. Documented as a UX gap, not a correctness one (the action still verifies the id belongs to the institution).
- `upsertFeeStructure`'s component upsert never removes a component head dropped from the form (upsert-by-head only, no delete pass) — shortcut, noted in a code comment in actions.ts. Upgrade if a demo scenario needs component removal.
- `assignFeeStructure` re-assigning the same student/year doesn't clear prior concessions on the same assignment row — shortcut, noted in a code comment. Upgrade if a demo re-assign scenario needs it.
- Bulk job-queue enqueue (06 §W9's described `generateTermInvoices` → `app.enqueue_job` path) is not implemented from TypeScript, by design: `app.enqueue_job` lives in the `app` schema, which `supabase/config.toml` exposes nowhere over PostgREST (`schemas = ["public", "storage", "graphql_public"]`), and `public.jobs` has no INSERT policy (service-role/`app.enqueue_job` only). `generateTermInvoices` therefore does the synchronous per-student path for whatever set it's given — correct for a single grade/term at a time, but a very large whole-school run (08 §risk: ~3,024 students) will run inside one server-action request with no batching. **Follow-up needed**: a new migration adding a `public.enqueue_term_invoices(term_id, grade_id)` security-definer wrapper (service_role + the finance-write role check already in `public.generate_invoice`) would let the action enqueue instead of running synchronously, and would let the job handler's own soft-budget cutoff actually resume via a fresh job row instead of relying on the runner's retry/backoff of the same job (which still works today, just with the generic `last_error`/backoff schedule rather than a clean continuation).

Limitations / honesty labels: no AI involved, no simulated channel — neither `<SimulatedBadge />` nor `<LimitedBadge />` applies to anything in this packet.

Security / integration risks:
- The soft-budget retry strategy in the job handler means a very large institution's invoice run could take several job attempts (default `max_attempts = 5`) before completing; if 5 attempts aren't enough the job dead-letters with partial invoices generated (safe — rerunning after a manual requeue picks up where it left off, no duplicates) but needs an operator to notice and requeue from `/jobs`.
- `generateTermInvoices`'s per-student loop makes one PostgREST round trip per student with no concurrency; for a single large grade this could approach the server action's own request timeout before the job-handler path would even be considered. Not a security risk, a latency one — flagged above as the bulk-enqueue follow-up.

Follow-ups (for 12-decision-log.md §Debt or a new task):
- `public.enqueue_term_invoices` wrapper migration (see "Deviations" above) to unlock true job-queue bulk generation.
- A student picker/search component, reusable by `FeeAssignmentDialog` and any future module that needs one.
- Component-removal and concession-replacement upgrades noted above if a demo scenario needs them.

New dependencies (justification): none.

Fix round 1 (code review, HIGH):

Finding: `generateTermInvoices` looped every matching student in one request with no deadline; `GenerateInvoicesPanel`'s "All grades" option meant a whole-school run (up to 3,024 students) could hit a platform timeout with no counts returned and no way to resume.

Fix:
- `GenerateTermInvoicesSchema.gradeId` is now required (was optional) — `tests/unit/finance-schemas.test.ts` (new) proves a missing grade is rejected.
- `generateTermInvoices`'s logic moved into an exported `runGenerateTermInvoices(supabase, ctx, input, budgetMs = 20_000)` (actions.ts), mirroring the job handler's soft-budget pattern. It now: looks up which of the matched students already have a Term invoice first (so a rerun does zero redundant `generate_invoice` calls, not just zero-effect ones), then loops only the remainder with a wall-clock deadline check per iteration, and returns `{ studentCount, generated, alreadyExisted, failed, remaining }`. `generateTermInvoices` (the `defineAction`-wrapped action) is now a thin wrapper calling this with the default budget.
- `GenerateInvoicesPanel.tsx`: removed the "All grades" `SelectItem`; grade is now a plain required picker (defaults to the first grade, submit disabled until chosen). The result message shows "`N remaining — run again to continue`" when `remaining > 0`, or a "Done" line when it reaches 0 — reruns are safe (`generate_invoice` is idempotent, and the new already-existing check skips them outright).
- The job handler (`finance.generate_term_invoices.ts`) was NOT touched — it already had its own `SOFT_BUDGET_MS` guard from the original implementation and `gradeId` stays optional there for the future whole-school phase-2 path through `public.enqueue_term_invoices` (migration 0017, not built yet, reserved per the coordinator's note).
- `runGenerateTermInvoices` is exported as a plain async function, not a constant, because `actions.ts` has `"use server"` at the top — Next.js only allows async-function exports from such a file; the budget default and the result interface are handled as a private `const` and a type-only export respectively to keep that constraint.

Tests added:
- `tests/unit/finance-schemas.test.ts`: `GenerateTermInvoicesSchema` rejects a payload with no `gradeId`, accepts one with it.
- `tests/db/invoice-generation.test.ts`, new case "Fix round 1 (HIGH)...": calls `runGenerateTermInvoices` directly with `budgetMs = 0` — deadline has already passed before the loop's first iteration, so it returns `{ generated: 0, remaining: 3 }` and creates zero invoices; a second call with the default budget finishes all 3 with `remaining: 0` and no duplicate rows (asserted by student-id set equality, not just count).
- Updated the four existing call sites that used `generateTermInvoices(..., { termId })` to also pass the now-required `gradeId`, and updated the AC3 rerun assertions to the new `{ generated, alreadyExisted, failed, remaining }` shape (second call: `generated: 0, alreadyExisted: 3`, since the already-existing check now skips `generate_invoice` entirely for students already invoiced, rather than calling it again and discovering the no-op).

Tests run (fix round 1): `pnpm vitest run --project db tests/db/invoice-generation.test.ts` → 11/11 pass. `pnpm vitest run --project unit tests/unit/finance-proration.test.ts` → 8/8 pass. `pnpm test` (full unit project) → 237/237 pass (235 prior + 2 new schema tests). `pnpm lint` → 0 errors, same 4 pre-existing warnings in `scripts/seed/sections/*` (not mine). `pnpm tsc --noEmit` clean.

Assumptions made:
- Default due date and financial-year math are entirely `app.generate_invoice`'s concern (already built in T-030); nothing in this packet duplicates or re-derives them.
- `tests/db/invoice-generation.test.ts` sets `institutions.settings.numbering.invoice_no`/`finance`/`locale` itself (same `setFinanceSettings` shape as T-030's `tests/db/finance.test.ts`) since a bare `createTestInstitution()` fixture has no numbering pattern configured and `app.generate_invoice` raises `invalid_state` without one.
- Did not touch `supabase/**`, `src/lib/auth/permissions.ts`, `src/modules/jobs/runner.ts`, `src/lib/nav.ts`, `tests/helpers/factories.ts`, or run any `db:*`/`seed`/`demo:reset`/`test:security`/full `test:db` command, per the packet's state/concurrency section.
- `tests/security/actions.test.ts` (listed in the packet's "Tests" section) does not exist on this branch yet — not run, nothing to run.
