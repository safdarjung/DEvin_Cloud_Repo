Packet: X05-T2 MSG91 WhatsApp adapter + template map
Files changed: src/modules/notifications/channels/whatsapp.ts (new), src/modules/notifications/channels/types.ts, src/modules/notifications/templates.ts, tests/unit/whatsapp-channel.test.ts (new), .env.example, vitest.config.mts
Behavior implemented: msg91WhatsApp/simulatedWhatsApp + whatsappConfigured()/whatsappChannel() selector; toMsisdn normaliser; whatsappMessage()/whatsappApprovalText() + WHATSAPP_PARAMS for the 5 sms-channel types; param sanitisation (collapse ws, cap 300, "-" fallback); result mapping per rulings (no_contact/invalid_phone/no_template/sent+providerRef/msg91_rejected/msg91_http_<n>/msg91_network, never throws, no secrets in error).
Found tree already carrying a complete, interrupted-run implementation matching the packet verbatim; verified against rulings line by line, no edits needed.
MSG91 field names confirmed via web search (docs.msg91.com): integrated_number, content_type, payload.template.{name,language,to_and_components} match ruling exactly — no discrepancy to record.
Tests run: pnpm test tests/unit/whatsapp-channel.test.ts tests/unit/notification-templates.test.ts tests/unit/resend-channel.test.ts -> 3 files, 52 passed. pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: tests/db/* and tests/security/* (T2 scope is unit-only per ACCEPT line).
Limitations / honesty label: unchanged — simulated rows inherit <SimulatedBadge /> via existing MessageLog rendering (T2 doesn't touch UI).
Security / integration risks: none new; adapter never logs key/number/response text in error strings (verified in tests).
Follow-ups: none for T2; T3 wires service.ts + delivery log per plan.
New dependencies: none.
Assumptions made: T1's module-catalog/migration/permissions diffs (visible in git status) are out of scope for T2 and untouched.
