Packet: T-011 M12-T11 Action `finance.payment.createIntent`
Files changed: src/modules/finance/online-payments.actions.ts (new); tests/db/online-payment-intent.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+1 C-03 fixture)
Behavior implemented: `createPaymentIntent` = defineAction(name finance.payment.createIntent, module online_payments, permission finance.payment.online). Flow: RLS-backed `requireVisibleInvoice` (not_found if hidden) -> existing intent for idempotency key returned as-is (no second gateway call) -> test mode: createRazorpayOrder (receipt = key w/o dashes, notes.invoice_id) / simulated: sim_order_<32 hex> -> rpc create_payment_intent. Returns {intentId, mode, provider, orderId, amountPaise, currency:"INR", keyId}; keyId only in test mode.
Tests run: `pnpm test:db tests/db/online-payment-intent.test.ts` -> 6/6 pass; `pnpm test tests/unit/action-names-unique.test.ts` -> 6/6 pass; `pnpm test:security tests/security/escalation.test.ts` -> 1092/1092 pass; `pnpm lint` clean; `pnpm typecheck` clean.
Tests not run: full test:db / db:reset / seed / db:types (DB-owner fence, per brief).
Limitations / honesty label: n/a — intent creation has no UI badge itself; mode surfaces to caller for T13/UI's `<LimitedBadge>`/`<SimulatedBadge>` per ruling.
Security / integration risks: none found. RLS + SQL definer (T5) are the real authorization boundary; TS layer only adds the pre-gateway idempotency-replay short-circuit and test-mode order creation.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: existing-intent amountPaise is derived from the stored row (not the replay request body) — a replay with a different `amount` still returns the original intent, matching the RPC's own idempotent fast path (06 ruling).
