Packet: T-0NN M06-T3 Preferences honoured by `createNotification` + `notify.announcement` handler

Files changed:
- src/modules/notifications/templates.ts (added `NotificationCategory`, `category` on every `TemplateDef` + each template, new `announcement` type/template {title, excerpt} vars)
- src/modules/notifications/service.ts (new `disabledChannels` lookup against `notification_preferences`; `createNotification` filters sms/email out of the channel list before `ensureDeliveryAttempts`, in_app never filtered)
- src/modules/jobs/handlers/notify.announcement.ts (new)
- src/modules/jobs/handlers/index.ts, src/modules/jobs/registry.ts (registered `notifyAnnouncement` / `"notify.announcement"`)
- src/modules/jobs/types.ts (added `"notify.announcement"` to the `JobType` union — unused elsewhere but kept consistent)
- tests/unit/notification-templates.test.ts (extended: announcement channels/category, strict vars schema, body rendering)
- tests/db/notify-announcement.test.ts (new)

Behavior implemented:
- Handler re-checks `announcements.status === 'published'` (skip otherwise), loads `announcement_audiences`, resolves recipients per ruling: `school`/`role` → every active membership (contacts from `guardians`/`staff` by `guardian_id`/`staff_id`); `grade`/`section` → students actively enrolled (`enrolments.status='active'`, current `academic_years.is_current`) → guardians with `guardian_students.portal_access=true` + the students' own active memberships. Deduped by `user_id`. Calls `createNotification` per recipient (`entityId` = announcement id → idempotent rerun); shortcut comment left for batching past ~5,000 recipients, not implemented.
- `createNotification` now drops any sms/email attempt that has an explicit `notification_preferences` row with `enabled=false` for that (user, institution, category) — missing row = still on (opt-out model), in_app never looked up.

Tests run:
- `pnpm test:db tests/db/notify-announcement.test.ts tests/db/notifications.test.ts tests/db/jobs.test.ts` → 30 passed (3 files: 5 new + 20 notifications + 5 jobs, all green).
- `pnpm test tests/unit/notification-templates.test.ts tests/unit/jobs-runner.test.ts` → 38 passed.
- `pnpm lint` → clean. `pnpm typecheck` → clean (whole repo, including the parallel agent's announcements.*/all-actions.ts files — no errors to exclude).

Tests not run: full `pnpm test:db` suite (single-file rule, not DB owner); no migration/db:reset/seed touched.

Limitations / honesty label: none — backend-only, no UI, no simulated/limited surface added here.

Security / integration risks: none found. Recipients/contacts are always re-read from current `enrolments`/`guardian_students`/`memberships`/`guardians`/`staff` rows at send time, never from job payload text (lesson 11). No phone/email ever logged.

Follow-ups: none for this task; T5 (announcement + preference actions) and T6 (HTTP acceptance) build on this.

New dependencies: none.

Assumptions made: announcement template channels = `["in_app", "sms", "email"]` (brief says delivery body is "SMS-safe", implying sms is attempted; email included since the category also gates email prefs) — not explicitly listed in the brief's EXPORTS line, recorded here. `notification_preferences` absence of a row = channel enabled (opt-out model) — brief says "drops sms/email attempts the recipient disabled", consistent with this default.
