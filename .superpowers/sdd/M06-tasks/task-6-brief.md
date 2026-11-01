### Task 6: M06-T6 Acceptance over HTTP
FILES: `tests/db/announcements-acceptance.test.ts` (new)
TEST: admin creates a section announcement + a role=teacher announcement via `/api/v1/actions/*`, publishes both; run the job runner once (as `tests/db/jobs.test.ts` does); guardian of that section sees the section notice in `GET /api/v1/query/notifications.listMyNotifications`, not the teacher one; guardian's direct PostgREST `select` on `announcements` → empty; a guardian who set `sms=false` for `announcement` has no sms `delivery_attempts` row for it; `GET /api/v1/query/core.audit.list` as admin shows `announcement.published`.
ACCEPT: `pnpm test:db tests/db/announcements-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T6: `07 §4` row for `publish_announcement`; `10-backlog-index` (0068 built, 0078 note); tracker; security review; full gate; commit/push; hosted push is owner-run (`pnpm exec supabase db push --linked --include-all`); `DONE M06 <sha>`.
