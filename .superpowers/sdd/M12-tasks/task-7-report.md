Packet: T7 M12-T7 Action finance.payment.void + void status on receipts
Files changed: src/modules/finance/reversals.actions.ts (new); src/modules/finance/queries.ts (getReceipt + ReceiptReversal, edit only); tests/db/finance-void.test.ts (new); src/app/api/v1/actions/all-actions.ts (import line); tests/security/escalation.test.ts (C-03 fixture)
Behavior implemented: voidPayment action (owner/principal, module finance_plus) proves payment belongs to ctx.institution, calls rpc("void_payment"), maps result, revalidates invoice/invoices/ledger/defaulters + receipt path. getReceipt gains reversal: {kind, reason, reversedAt} | null via payment_reversals read (RLS-scoped).
Tests run: pnpm test:db tests/db/finance-void.test.ts -> 6/6 pass. pnpm test tests/unit/action-names-unique.test.ts -> 6/6 pass. pnpm test:security tests/security/escalation.test.ts -> 1082/1082 pass. pnpm lint: 1 pre-existing error in src/modules/finance/with-service-role.ts (not my file, T12's). pnpm typecheck: 1 pre-existing error in queries.ts:671 inside collectionReport (T9's function, not touched by me) — my added lines (queries.ts 311-383, reversals.actions.ts, finance-void.test.ts) have zero errors.
Tests not run and why: full test:db / test:security suites (brief restricts to own files; other tasks running concurrently).
Limitations / honesty label: none — no UI/badge surface in this task.
Security / integration risks: none new. requirePayment mirrors requireInvoice's BOLA-guard pattern; module gating (finance_plus, default-on) checked by defineAction before permission.
Follow-ups: none for T7 itself.
New dependencies (justification): none
Assumptions made: throwMapped/requirePayment duplicated locally in reversals.actions.ts rather than exported from actions.ts (shared file, read-only per brief). Receipt revalidatePath looked up via a best-effort query (not in RPC payload); a miss is non-fatal.
