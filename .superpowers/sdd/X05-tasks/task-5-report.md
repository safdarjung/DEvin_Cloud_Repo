Packet: X05-T5 Acceptance over HTTP
Files changed: tests/db/whatsapp-acceptance.test.ts (new); src/modules/core/schemas.ts (one-line fix: added "whatsapp" to SetModuleEnabledSchema's key enum — T1 added the catalog entry/migration but missed this zod literal list, so core.module.set rejected key:"whatsapp" with validation_failed; same enum already has "library" from another task's fix).
Behavior: one fixture institution (is_demo=false), one section, guardian A (fixture) + guardian B (own auth user/token) both linked via guardian_students. B opts out of whatsapp/announcement over HTTP -> 200. Admin publishes a section announcement, runOnceCore once: A gets whatsapp sent/msg91/wa_1 (MSG91 body: coolskool_announcement, to=[91<A phone>], body_1=title), B gets no whatsapp attempt but does get sms, admin's listDeliveryLog shows a whatsapp row, rerun makes no extra MSG91 call. Admin disables whatsapp module -> A's preference set is 403 forbidden (exact MODULE_DISABLED_MESSAGE); second announcement + runner yields no whatsapp attempts, no new calls. Module back on + key unstubbed: third announcement is simulated, zero calls.
Tests run: pnpm test:db tests/db/whatsapp-acceptance.test.ts -> 1/1 passed. pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: none skipped (single-file ACCEPT commands only, per lane DB-owner fence).
Limitations / honesty label: unchanged, whatsapp rows inherit <SimulatedBadge /> (M17-T4).
Security / integration risks: none new. schemas.ts fix is additive-only (one enum member); re-read file immediately before editing per shared-file rule.
Follow-ups: none new for T5.
New dependencies (justification): none.
Assumptions made: guardian A reached via guardian_students (not the pre-existing membership alone) since the section-audience handler resolves recipients off guardian_students+enrolments, matching announcements-acceptance.test.ts's own fixture pattern.
