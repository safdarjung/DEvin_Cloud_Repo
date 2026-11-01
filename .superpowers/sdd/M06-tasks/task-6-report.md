Packet: M06-T6 — announcements acceptance over HTTP

Files changed: tests/db/announcements-acceptance.test.ts (new, only file touched)

Behavior implemented:
One HTTP acceptance test proving the M6 path end to end against real Supabase/RLS (no `@/lib/supabase/server` mock):
1. Guardian sets sms=false for category `announcement` via `notification.preferences.set` action.
2. Admin creates + publishes a `section` announcement and a `role=teacher` announcement via `announcement.create`/`announcement.publish`.
3. Job runner run once via `runOnceCore(..., createRunnerPorts(admin))` (same pattern as tests/db/jobs.test.ts).
4. Guardian's `notifications.listMyNotifications` shows the section notice's body, not the teacher notice's.
5. Guardian's direct PostgREST `select` on `announcements` returns `{ data: [], error: null }` (RLS scopes to owner/principal/admin only).
6. Guardian's `delivery_attempts` for that notification contain `in_app`, not `sms`.
7. Admin's `core.audit.list` shows exactly 2 `announcement.published` events.

Tests run: `pnpm test:db tests/db/announcements-acceptance.test.ts` → 1 passed (ran twice, stable). `pnpm lint` → clean. `pnpm typecheck` → clean.

Tests not run and why: full `pnpm test:db` suite — brief restricts non-DB-owner to own file only.

Limitations / honesty label: n/a (no simulated/limited UI surface in this test).

Security / integration risks: none found — RLS on `announcements`/`announcement_audiences` behaved as migration 0068 intends (guardian sees zero rows direct, notification-only access).

Follow-ups: none.

New dependencies (justification): none.

Assumptions made: notification `title` field is the fixed per-type template string ("New announcement"); the announcement's own title only appears interpolated into `body` (`${title}: ${excerpt}`, src/modules/notifications/templates.ts) — asserted against `body`, not `title`.
