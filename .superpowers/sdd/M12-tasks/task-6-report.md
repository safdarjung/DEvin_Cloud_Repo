Packet: M12-T6 Notification template fee_reminder
Files changed: src/modules/notifications/templates.ts, src/modules/notifications/announcements.schemas.ts, tests/unit/notification-templates.test.ts
Behavior implemented: Added `fee_reminder` notification type with category `finance` and channels `in_app`, `sms`, `email`. Vars schema: {student, invoice_no, amount, due_on, school}. EN: "Fee reminder: {amount} is due for {student} (invoice {invoice_no}, due {due_on}). Please pay at the school office. -{school}". HI: "शुल्क अनुस्मारक: {student} के लिए {amount} बकाया है (चालान {invoice_no}, देय तिथि {due_on})। कृपया विद्यालय कार्यालय में भुगतान करें। -{school}". Added `finance` category to NotificationCategory type and PREFERENCE_CATEGORIES.
Tests run: `pnpm test tests/unit/notification-templates.test.ts` → 13 passed (13); `pnpm lint` → clean; `pnpm typecheck` → clean
Limitations / honesty label: None
Security / integration risks: None—pure data schema, no runtime logic
Follow-ups: None (task complete per spec)
New dependencies: none
Assumptions made: English and Hindi text per rulings exact; amount pre-formatted as string (e.g., "₹12,345.00") supplied by caller
