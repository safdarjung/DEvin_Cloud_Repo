### Task 5: M06-T5 Announcement + preference actions
READ: BRIEF-COMMON.md; rulings; Task 2 migration; `src/modules/documents/actions.ts` (style)
FILES: `src/modules/notifications/announcements.schemas.ts` (new); `src/modules/notifications/announcements.actions.ts` (new, `"use server"`); `tests/db/announcement-actions.test.ts` (new); + manifest line + escalation fixtures
EXPORTS: `announcement.create` {title, body, category?, audiences: [{type, role?, gradeId?, classSectionId?}] 1–20} → draft + audiences (`announcement.manage`); `announcement.publish` {announcementId} → `publish_announcement` RPC (`announcement.manage`); `notification.preferences.set` {category, channel, enabled} → upsert own row (`notification.read`). Audit (ids/counts only).
TEST FIRST: admin creates + publishes → job queued; teacher create → forbidden; audience with a grade from another institution → rejected; preferences round-trip; guardian can set own preference.
ACCEPT: `pnpm test:db tests/db/announcement-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

