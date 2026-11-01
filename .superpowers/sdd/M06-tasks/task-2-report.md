Packet: T-0NN M06-T2 Migration 0068 — announcements, audiences, preferences, publish RPC

Files changed:
- supabase/migrations/20261028000068_announcements.sql (new)
- tests/db/announcements-rls.test.ts (new)
- tests/security/rls-expectations.ts (added announcements, announcement_audiences, notification_preferences)
- tests/security/grants.test.ts (added public.publish_announcement to PUBLIC_AUTHENTICATED)
- src/lib/db/types.ts (raw `pnpm db:types` regen, additions only)

Behavior implemented:
- `public.announcements` (draft/published, title 1-120, body 1-4000, category, created_by) and `public.announcement_audiences` (school/role/grade/section, FK-bound to institution via `with check`) — managers-only RLS (owner/principal/admin), audiences writable only while parent is draft.
- `public.notification_preferences` — own-row RLS, PK (user_id, institution_id, category, channel), caller must be an active member.
- `app.guard_announcements_update` trigger: blocks any edit once published, blocks direct status change; only the GUC `app.allow_announcement_publish` (set by publish_announcement) may move draft→published.
- `app.publish_announcement`/`public.publish_announcement` (same app+public split as publish_exam_results/publish_page): role check, draft-only (else code:invalid_state), ≥1 audience required (else code:validation_failed), flips status, enqueues one `notify.announcement` job (payload `{announcement_id}`, idempotency key `announcement:<id>`), audits `announcement.published`.

Definer functions (search_path='', own-role+institution check):
- `app.publish_announcement(uuid)` — revoked from public/anon/authenticated; checks caller's role against the announcement's own institution_id.
- `public.publish_announcement(uuid)` — thin wrapper, revoked from public/anon, granted to authenticated.
(`app.guard_announcements_update` is a plain plpgsql trigger function, not security definer — same unrevoked shape as 0067's `app.guard_documents_update`.)

Tests run:
- `pnpm test:db tests/db/announcements-rls.test.ts` → 11 passed (RLS + publish RPC: draft create, teacher/guardian blocked on insert+select, guardian blocked reading a role=teacher announcement, publish sets status+exactly one job row with `{announcement_id}`, publish-with-no-audience → validation_failed, publish-twice → invalid_state, edit-after-publish rejected, audience-insert-after-publish rejected, teacher publish → forbidden, own-vs-other preference row).
- `pnpm test:security` → 1352 passed, 18 files (updated RLS_EXPECTATIONS + PUBLIC_AUTHENTICATED list as required — said so above).
- `pnpm typecheck` clean; `pnpm exec eslint` clean on touched files.

Tests not run: `pnpm lint` (project-wide) not run — ran targeted eslint on touched files only per token rules; `pnpm test:db` full suite not run (single-file rule, DB owner).

Limitations / honesty label: none — no UI, no simulated/limited surface in this packet.

Security / integration risks: none found. `app.enqueue_job` stays un-grantable to `authenticated` (lesson 3) — only reachable via the two security-definer RPC pairs now including this one.

Follow-ups: M06-T3 owns the fan-out (notify.announcement job handler resolves school/role/grade/section → notifications, honors notification_preferences) — not in scope here, deliberately deferred per ruling.

New dependencies: none.

Assumptions made: `role` column on announcement_audiences allows the full memberships role list (owner..guardian) per brief wording "role (memberships role list)" rather than a narrower subset. `category`/`channel` on notification_preferences match the ruling text verbatim. No DELETE policy added on any of the three tables (brief's EXPORTS line only specified SELECT/INSERT/UPDATE).
