Packet: M17-T1 Resend channel adapter + emailChannel() selector
Files changed: src/modules/notifications/channels/resend.ts (new); src/modules/notifications/channels/types.ts (+subject?, +idempotencyKey?); tests/unit/resend-channel.test.ts (new); .env.example (+RESEND_API_KEY, +RESEND_FROM); vitest.config.mts (+1 line delete RESEND_API_KEY)
Behavior implemented: resendConfigured() reads env per call. emailChannel() returns resendEmail or simulatedEmail. resendEmail posts to api.resend.com/emails (Bearer, Idempotency-Key, from/to/subject/text, 10s AbortSignal timeout); reserved test domains (.test/.example/.invalid/.localhost, example.com/net/org) delegate to simulatedEmail; 429 retries once after min(Retry-After,2)s; non-2xx -> failed resend_http_<status>; network error -> failed resend_network; never throws, never logs/echoes address.
Tests run: pnpm test tests/unit/resend-channel.test.ts tests/unit/notification-templates.test.ts -> 2 files, 19 tests, all passed. pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: tests/db, tests/security, tests/e2e not touched by this task (no DB/action/RLS changes), per packet scope (T1 is adapter-only).
Limitations / honesty label: n/a — no UI/badge change in this task (T4 handles badges).
Security / integration risks: none new; key read only inside resend.ts via resendConfigured/postOnce; error strings never include caller address or response body.
Follow-ups: none beyond T6's listed debt (webhook tracking, no retry of failed rows, sequential fan-out, invite not in delivery_attempts, accept page) — not introduced by T1.
New dependencies (justification): none (fetch only, per ruling).
Assumptions made: Retry-After header parsed as plain seconds (Resend docs convention); missing/invalid header falls back to 1s default per ruling.
