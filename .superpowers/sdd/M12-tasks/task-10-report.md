Packet: M12-T10 Razorpay client (fetch + HMAC)
Files changed: src/modules/finance/razorpay.ts (new), tests/unit/razorpay.test.ts (new), .env.example (appended, names only)
Behavior implemented: onlinePaymentsMode(env?) test iff rzp_test_ key + secret, else simulated (incl. rzp_live_). createRazorpayOrder: POST v1/orders, Basic auth, INR, Zod `id: /^order_/`, AbortSignal.timeout(10s); not-test-mode/non-2xx/malformed/timeout -> AppError("dependency_failed", generic msg, no key/body). verifyRazorpaySignature: HMAC-SHA256 hex + timingSafeEqual, never throws, false on missing/short/tampered. RazorpayWebhookSchema (non-strict) + RazorpayWebhook type for T12.
Tests run: pnpm test tests/unit/razorpay.test.ts -> 14 passed, 14 total (TDD: confirmed RED — module-not-found — before implementing, then GREEN). pnpm lint (both files) -> clean. pnpm typecheck -> no errors in touched files (pre-existing unrelated errors in files from concurrent agents, not touched by this task).
Tests not run and why: pnpm test:db / test:security / test (full) — not this task's scope, no DB/action code added.
Limitations / honesty label: no UI; badge wiring is T11's job (createIntent carries `mode`). Not applicable here.
Security / integration risks: none new — pure fetch/crypto module, no secrets logged, AppError messages generic (verified by test).
Follow-ups: none.
New dependencies (justification): none (fetch + node:crypto, per packet).
Assumptions made: RazorpayWebhookSchema shape (event/payload.payment.entity, payload.order.entity) modeled on Razorpay's real payment.captured/order.paid payloads for T12's reuse; not itself in TEST FIRST list so untested here. Included `import "server-only"` (matches finance/queries.ts convention; mocked in vitest config) since this file is only ever imported from "use server" actions (T11) and the webhook route (T12), never the plain-node job runner.
