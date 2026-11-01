# M06 — Announcements, notification preferences, audit viewer

Source: `07-master-plan-v1-v2.md` §3 M6. Migration `0068` (claimed). No new deps. Replaces fixture `AuditEventRow` (`src/modules/fabric/types.ts`). Owning module for announcements and preferences: `src/modules/notifications`.

Rulings (recorded in the ledger):
- **Audit viewer needs no RPC.** `audit_events_select` RLS already = owner/principal/admin = `audit.read` holders; `core.audit.list` is a plain RLS read. 0078's "audit read RPC" part is dropped (0078 stays reserved for M16 approvals).
- **Announcements table is managers-only.** SELECT/INSERT/UPDATE on `announcements` and `announcement_audiences` = owner/principal/admin (`announcement.manage`). Recipients never read the table — they get a `notifications` row. So a guardian cannot read a staff-only announcement over PostgREST (lesson 1) by construction.
- **Publish is a definer RPC** `public.publish_announcement(p_announcement_id)`: role check, draft-only, ≥ 1 audience, sets `published` under GUC `app.allow_announcement_publish`, enqueues `notify.announcement` with payload `{announcement_id}` built in SQL (lesson 3), idempotency key `announcement:<id>`, audit. A guard trigger blocks any status change without the GUC and any edit of a non-draft row; audiences are writable only while the parent is a draft.
- Audience rows: `school` (everyone active), `role` (members with that role), `grade` / `section` (guardians + students of students actively enrolled there in the current year). Staff for a grade/section are reached with a `role` audience.
- **Preferences:** `notification_preferences` (user, institution, category, channel ∈ sms|email, enabled). In-app is always on. Category comes from the template (`TemplateDef.category`): attendance, academic, admissions, announcement. `createNotification` drops sms/email attempts the recipient disabled — one place, every notification type.
- New permission `announcement.manage` = owner, principal, admin. Preferences use `notification.read` (all roles), own rows only.
- Announcement delivery body = title + first 280 chars of the body (SMS-safe); full text stays in-app via `data`.

Model routing (owner rule 2026-11-01): Haiku = T1 (done inline), T4; Sonnet = T2, T3, T5, T6. Parallel: T2 ‖ T4; then T3 ‖ T5; then T6.

Every new action: manifest import + C-03 fixture. Every new query: `query-defs.ts` + `all-queries.ts` + sample input in `tests/db/api-query-route.test.ts`. Seed-imported files: relative `.ts` imports.

---

### Task 1: M06-T1 Permission `announcement.manage`
FILES: `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `07-security-and-ai-governance.md` §2.2
EXPORTS: key held by owner, principal, admin.
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts`

### Task 2: M06-T2 Migration 0068 — announcements, audiences, preferences, publish RPC
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000003_platform.sql` (`app.enqueue_job`, notifications), `…0067_documents.sql` (style, guard trigger), `…0020*.sql` (initPlan helpers)
FILES: `supabase/migrations/20261028000068_announcements.sql` (new); `tests/db/announcements-rls.test.ts` (new); `src/lib/db/types.ts` (regen)
EXPORTS: `public.announcements` (id, institution_id, title 1–120, body 1–4000, category text default 'general' check in ('general','academic','event','holiday','fees','emergency'), status default 'draft' check in ('draft','published'), published_at, published_by, created_by not null, created_at, updated_at); `public.announcement_audiences` (id, announcement_id → announcements, institution_id, audience_type check in ('school','role','grade','section'), role (memberships role list), grade_id → grades, class_section_id → class_sections; check exactly the target column its type needs; FKs bound to the institution in `with check`); `public.notification_preferences` (user_id → profiles, institution_id, category check in ('attendance','academic','admissions','announcement'), channel check in ('sms','email'), enabled bool not null, created_at, updated_at, PK (user_id, institution_id, category, channel)) — RLS own rows only and the caller must be an active member of that institution; guard trigger + `public.publish_announcement` per rulings (`execute` to authenticated only; `app.*` helpers revoked from public).
TEST FIRST: admin creates draft + audience → ok; teacher/guardian cannot insert or select announcements (direct PostgREST); guardian cannot read a role=teacher announcement; publish as admin → status published + one `notify.announcement` job with `{announcement_id}` only; publish twice → invalid_state; edit after publish → rejected; audience insert on a published announcement → rejected; teacher publish → forbidden; user sets own preference, cannot read/write another user's.
ACCEPT: `pnpm test:db tests/db/announcements-rls.test.ts`; `pnpm test:security` (update expectations if needed — say so); `pnpm lint`; `pnpm typecheck`

### Task 3: M06-T3 Preferences honoured by `createNotification` + `notify.announcement` handler
READ: BRIEF-COMMON.md; rulings; `src/modules/notifications/{service,templates}.ts`; `src/modules/jobs/{handlers/index.ts,registry.ts}`; `src/modules/jobs/handlers/notify.enrolment_welcome.ts` (pattern); `tests/db/notifications.test.ts`, `tests/db/jobs.test.ts`
FILES: `src/modules/notifications/templates.ts` (add `category` to every template + `announcement` template, vars {title, excerpt}); `src/modules/notifications/service.ts` (filter sms/email by the recipient's disabled preferences for the template's category before `ensureDeliveryAttempts`); `src/modules/jobs/handlers/notify.announcement.ts` (new) + registration in `handlers/index.ts`/`registry.ts`; `tests/db/notify-announcement.test.ts` (new)
EXPORTS: handler loads the published announcement (skip if not published), resolves recipients per rulings (active memberships only, deduped by user), contacts from current guardian/staff rows (never payload), calls `createNotification` per recipient with `entityId` = announcement id (idempotent rerun). shortcut comment: per-recipient inserts; batch when an audience exceeds ~5,000.
TEST FIRST: section audience → guardians of that section's students notified, other guardians not; role=teacher → teachers only; rerun creates nothing new; recipient with sms disabled for `announcement` gets in-app + no sms attempt; existing notification tests stay green.
ACCEPT: `pnpm test:db tests/db/notify-announcement.test.ts tests/db/notifications.test.ts tests/db/jobs.test.ts`; `pnpm test tests/unit/notification-templates.test.ts tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 4: M06-T4 `core.audit.list` query (Haiku)
READ: BRIEF-COMMON.md; `AuditEventRow` in `src/modules/fabric/types.ts`; `src/modules/imports/queries.ts` + `query-defs.ts` (pattern); `tests/db/audit-event.test.ts`
FILES: `src/modules/core/audit.queries.ts` (new); `src/modules/core/query-defs.ts` (edit: add one def); `tests/db/audit-list-query.test.ts` (new); + sample input line in `tests/db/api-query-route.test.ts`
EXPORTS: `listAuditEvents(ctx, { from?, to?, action?, entityType?, page = 1, pageSize = 50 (max 100) }) → { rows: AuditEventRow[]; total: number }` — RLS read of `audit_events` for `ctx.institution.id`, newest first, `count: "exact"`; one extra query for actor names (`profiles.full_name`) and one for roles (`memberships.role` in this institution) over the page's distinct `actor_user_id`s; `actor` = name or `"system"`, `actor_role` = role or `"system"`, `event` = action, `entity` = entity_type, `entity_id` = entity_id ?? "", `at` = created_at, `summary` = `${action} on ${entity_type}`. Query def `core.audit.list`, permission `audit.read`, Zod: dates ISO, strings ≤ 100, page ≥ 1, pageSize 1–100. Import the `AuditEventRow` type from fabric types (type equality = the fixture contract).
TEST FIRST: admin lists events newest first with total; filter by action; teacher → forbidden; another institution's events never appear; pageSize 101 → validation_failed.
ACCEPT: `pnpm test:db tests/db/audit-list-query.test.ts tests/db/api-query-route.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: M06-T5 Announcement + preference actions
READ: BRIEF-COMMON.md; rulings; Task 2 migration; `src/modules/documents/actions.ts` (style)
FILES: `src/modules/notifications/announcements.schemas.ts` (new); `src/modules/notifications/announcements.actions.ts` (new, `"use server"`); `tests/db/announcement-actions.test.ts` (new); + manifest line + escalation fixtures
EXPORTS: `announcement.create` {title, body, category?, audiences: [{type, role?, gradeId?, classSectionId?}] 1–20} → draft + audiences (`announcement.manage`); `announcement.publish` {announcementId} → `publish_announcement` RPC (`announcement.manage`); `notification.preferences.set` {category, channel, enabled} → upsert own row (`notification.read`). Audit (ids/counts only).
TEST FIRST: admin creates + publishes → job queued; teacher create → forbidden; audience with a grade from another institution → rejected; preferences round-trip; guardian can set own preference.
ACCEPT: `pnpm test:db tests/db/announcement-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 6: M06-T6 Acceptance over HTTP
FILES: `tests/db/announcements-acceptance.test.ts` (new)
TEST: admin creates a section announcement + a role=teacher announcement via `/api/v1/actions/*`, publishes both; run the job runner once (as `tests/db/jobs.test.ts` does); guardian of that section sees the section notice in `GET /api/v1/query/notifications.listMyNotifications`, not the teacher one; guardian's direct PostgREST `select` on `announcements` → empty; a guardian who set `sms=false` for `announcement` has no sms `delivery_attempts` row for it; `GET /api/v1/query/core.audit.list` as admin shows `announcement.published`.
ACCEPT: `pnpm test:db tests/db/announcements-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T6: `07 §4` row for `publish_announcement`; `10-backlog-index` (0068 built, 0078 note); tracker; security review; full gate; commit/push; hosted push is owner-run (`pnpm exec supabase db push --linked --include-all`); `DONE M06 <sha>`.
