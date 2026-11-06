Packet: X04-T5 Actions `feePlans.lateFeeRule.upsert`, `feePlans.instalments.set`

Files changed: `src/modules/fee-plans/actions.ts` (new); `tests/db/fee-plans-actions.test.ts` (new); `src/app/api/v1/actions/all-actions.ts` (+1 import line); `tests/security/escalation.test.ts` (+2 C-03 fixtures).

Behavior implemented: `upsertLateFeeRule` — proves `feeStructureId` in `ctx.institution` (else not_found), upserts `late_fee_rules` on `fee_structure_id` conflict with `updated_by`, audits `fee_plans.late_fee_rule.upserted`. `setInstalments` — proves invoice first (not_found before RPC), calls `set_invoice_instalments`; SQL `validation_failed` remapped to `fieldErrors.parts`; no second audit (SQL already writes `fee_plans.instalments.set`). Both `module: "fee_plans"`, `permission: "finance.plan.manage"`.

Tests run: `pnpm test:db tests/db/fee-plans-actions.test.ts` -> 9/9 pass; `pnpm test tests/unit/action-names-unique.test.ts` -> 6/6 pass; `pnpm test:security tests/security/escalation.test.ts` -> 1192/1192 pass; `pnpm lint` -> 0 errors (8 pre-existing warnings, unrelated file `tests/unit/mastery-schemas.test.ts`); `pnpm typecheck` -> clean.

Tests not run and why: full `test:security`/`test:db` suites (packet scopes to the files above; other lanes edit concurrently).

Limitations / honesty label: none (no UI, no simulated/limited surface here).

Security / integration risks: `escalation.test.ts` and `all-actions.ts` are shared registries — edited (append only), re-read immediately before editing, confirmed against current disk state before this session touched them (no prior X04-T5 work found).

Follow-ups: none new.

New dependencies: none.

Assumptions made: revalidatePath paths — `upsertLateFeeRule` revalidates `finance/structures/[id]` (structure-scoped, mirrors `upsertFeeStructure`); `setInstalments` revalidates `finance/invoices` + `finance/invoices/[id]` (invoice-scoped, mirrors `recordPayment`) — ruling's "like recordPayment" read as shape-reference, not literal path reuse for the rule action.
