Packet: M12-T12 Webhook route /api/public/payments/razorpay
Files changed: src/app/api/public/payments/razorpay/route.ts (new); src/modules/finance/with-service-role.ts (new); tests/db/razorpay-webhook.test.ts (new); src/lib/supabase/admin.ts (ALLOWED_CALLERS += payments_webhook, edit); tests/security/allow-list.test.ts (ADMIN_IMPORT_ALLOWED += with-service-role.ts, edit); eslint.config.mjs (no-restricted-imports override for the new factory, edit — same shape as T-024's).
Behavior implemented: POST verifies HMAC (raw text, 64KB cap, before JSON.parse) -> handles payment.captured/order.paid (captured+INR only) -> looks up intent by order id (service role) -> checks online_payments module for intent's institution -> calls record_online_payment. Never logs raw body.
Tests run: pnpm test:db tests/db/razorpay-webhook.test.ts -> 8/8 pass (503 no secret, 413 oversized, 400 forged sig, 400 missing sig, 200 ignored:event, 404 unknown order, happy path + replay + order.paid duplicate, 200 ignored:module_disabled). pnpm test:security tests/security/allow-list.test.ts -> 3/3 pass. pnpm lint -> clean (1 pre-existing warning in src/modules/jobs/registry.ts, not my file). pnpm typecheck -> clean.
Tests not run: full test:db/test:security/seed/db:reset (brief: own files + no state changes).
Limitations / honesty label: n/a (server route, no UI).
Security / integration risks: route is sole caller of record_online_payment (service_role grant, 07 §4); institution_id always from intent row, never payload notes; module check before any write.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: order.paid webhook payload carries payload.payment.entity (per T10's RazorpayWebhookSchema and Razorpay's real event shape) — same captured/INR check applies to both handled events, per ruling text.
