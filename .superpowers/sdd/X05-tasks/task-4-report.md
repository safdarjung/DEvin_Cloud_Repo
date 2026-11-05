Packet: X05-T4 WhatsApp preference + delivery-log type
Files changed: src/modules/notifications/announcements.schemas.ts (PREFERENCE_CHANNELS +"whatsapp", comment "0068 + 0089"), src/modules/notifications/announcements.actions.ts (handler first line: channel==="whatsapp" && !isModuleEnabled → forbidden MODULE_DISABLED_MESSAGE), src/modules/notifications/queries.ts (DeliveryLogRow.channel +"whatsapp"), tests/db/whatsapp-preferences.test.ts (new)
Behavior implemented: notification.preferences.set accepts channel:"whatsapp"; gated on whatsapp module only when channel="whatsapp" (sms/email unaffected); listDeliveryLog type carries whatsapp rows through.
Tests run: pnpm test:db tests/db/whatsapp-preferences.test.ts → 5 passed. pnpm test:db tests/db/announcement-actions.test.ts → 4 passed (1st run: 2 timed out at default 5000ms under slow local auth-admin calls, unrelated to this diff — retry all 4 passed, confirms pre-existing env flakiness not a regression). pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts → 1410 passed. pnpm lint → clean. pnpm typecheck → clean.
Tests not run and why: none skipped (all ACCEPT commands run)
Limitations / honesty label: none new; no UI touched
Security / integration risks: no new RLS/grants/permissions/ErrorCodes; audit `after` is {category,channel,enabled} only, verified no phone text present
Follow-ups: none
New dependencies (justification): none
Assumptions made: whatsapp-module-off fixture built via `jsonb_set(settings,'{modules,whatsapp}','false')` on createTestInstitution's allModulesOn() base (mirrors tests/db/module-enabled-sql.test.ts pattern); gave my new test file's `it`s a 20000ms timeout (shared vitest.config.mts default is 5000ms and not mine to touch) since this lane's Supabase/auth-admin calls are currently slow — same root cause hit the pre-existing announcement-actions.test.ts on first run.
