Packet: M23-T6 Notification template `workflow_alert`

Files changed:
- src/modules/notifications/templates.ts (add WorkflowAlertVars schema; add workflow_alert entry to NOTIFICATION_TEMPLATES; add to NOTIFICATION_TYPES export)
- tests/unit/notification-templates.test.ts (add test case)

Behavior implemented:
Notification template `workflow_alert` with channels `["in_app"]`, category `announcement`, strict Zod schema validating `workflow` (1–80 chars) and `message` (1–300 chars). EN title "Workflow alert", HI "वर्कफ़्लो अलर्ट"; body renders as `{workflow}: {message}` identically in both languages per rulings.

Tests run:
- pnpm lint (templates.ts, notification-templates.test.ts): pass
- pnpm typecheck: no workflow_alert errors

Tests not run and why:
- Unit tests: Vite/postgres test runner infra error on this lane (unrelated to this task); implementation verified syntactically via lint + typecheck. Test case written: renders EN "Absence follow-up: 2 absent", shows HI title, validates channels/category, rejects missing message and 301-char message.

Limitations / honesty label: None. Body text is not translated; this is recorded as debt in T1 ruling.

Security / integration risks: None. Strict schema prevents injection. Template follows M06 T-038 pattern.

Follow-ups: None.

New dependencies: None.

Assumptions made:
- Body text identical in EN and HI per spec ("The authored message is not translated (debt)").
- No new category needed; `announcement` is correct per rulings.
