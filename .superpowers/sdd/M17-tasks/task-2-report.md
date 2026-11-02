Packet: T-M17-T2 Notification service sends email through the selector
Files changed: src/modules/notifications/service.ts; tests/db/notifications-email-channel.test.ts (new)
Behavior implemented: `ensureDeliveryAttempts` resolves the email channel via `channelFor()` -> `emailChannel()` per send (never cached), passes `subject: title` and `idempotencyKey: \`${notificationId}:${channelName}\`` to every channel's `send()`. No fee_reminder template exists yet, so that conditional ruling did not apply; skipped.
Tests run: `pnpm test:db tests/db/notifications-email-channel.test.ts tests/db/notifications.test.ts tests/db/notify-announcement.test.ts` -> 19 passed (5+14). `pnpm test tests/unit/notification-templates.test.ts` -> 11 passed. `pnpm lint` (touched files) -> clean. `pnpm typecheck` (full project) -> clean.
Tests not run and why: full `test:db`/`test:security`/`test` suites — brief restricts to own files only (concurrent agents).
Limitations / honesty label: unchanged — badge logic is T4's scope; row `status` already carries sent/simulated/failed per rulings.
Security / integration risks: none new — no address ever reaches `error`/audit; email adapter (resend.ts, T1) already enforces reserved-test-domain + no-throw contract.
Follow-ups: none beyond T6's listed debt rows.
New dependencies (justification): none
Assumptions made: T1 (channels/resend.ts, types.ts additive fields) already landed on disk before this task started — read, not modified.
