Packet: M15-T7 Template `report_ready`
Files changed: src/modules/notifications/templates.ts, tests/unit/notification-templates.test.ts
Behavior implemented: Added `report_ready` notification type to NOTIFICATION_TYPES. Added `"report"` category to NotificationCategory union. Created ReportReadyVars schema enforcing `report` (1–80 chars) and `date` (1–20 chars), rejecting empty/missing/extra fields. Template renders EN/HI bodies per rulings: EN "Report ready" / "{report} for {date} is ready to download."; HI "रिपोर्ट तैयार" / "{report} ({date}) डाउनलोड के लिए तैयार है।". Channels exactly `["in_app"]`.
Tests run: `pnpm test tests/unit/notification-templates.test.ts` → 12 passed (1 new test: report_ready renders EN/HI, rejects missing date, validates strict schema, checks channels and category)
Lint: 2 errors in src/modules/reports/schemas.ts (T2 packet — not my scope); none in my files
Typecheck: errors in T2 schemas (not my scope); my changes compile
Limitations / honesty label: None (template is core, no simulation)
Security / integration risks: None (template strings are immutable per spec; no user input)
Follow-ups: None
New dependencies: none
Assumptions made: `report_ready` is the only new type for M15 (T1 rulings confirm this); NOTIFICATION_TEMPLATES satisfies constraint on completion
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
