Packet: M23-T6 Notification template `workflow_alert`

Files changed:
- src/modules/notifications/templates.ts (workflow_alert def + WorkflowAlertVars schema)
- tests/unit/notification-templates.test.ts (workflow_alert test case)

Behavior implemented:
Notification template `workflow_alert` with channels `["in_app"]`, category `announcement`, strict Zod schema validating `workflow` (1–80 chars) and `message` (1–300 chars). EN title "Workflow alert", HI "वर्कफ़्लो अलर्ट"; body renders as `{workflow}: {message}` in both languages per rulings. Template already in NOTIFICATION_TYPES export.

Tests run:
- pnpm test tests/unit/notification-templates.test.ts: 16/16 pass (workflow_alert test covers renders EN "Absence follow-up: 2 absent", HI title, channels/category, rejects missing message and 301-char message)
- pnpm lint: pass
- pnpm typecheck: pass

Tests not run and why:
None. All required checks passed.

Limitations / honesty label:
None. Body text is not translated; recorded as debt in rulings.

Security / integration risks:
None. Strict schema prevents injection. Follows M06 T-038 pattern.

Follow-ups:
None.

New dependencies:
None.

Assumptions made:
Body identical in EN and HI (authored message not translated, per rulings).
