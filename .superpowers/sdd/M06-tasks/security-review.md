# M06 security review — migration 0068, announcements, notify.announcement, audit.list

Scope reviewed: supabase/migrations/20261028000068_announcements.sql; src/modules/notifications/announcements.{actions,schemas}.ts;
src/modules/jobs/handlers/notify.announcement.ts; src/modules/notifications/service.ts (createNotification/disabledChannels diff);
src/modules/notifications/templates.ts (category diff); src/modules/core/audit.queries.ts; src/modules/core/query-defs.ts
(core.audit.list); supporting reads: src/lib/auth/permissions.ts, src/lib/actions/define-action.ts, src/lib/actions/result.ts
(mapSqlError), core RLS helpers (app.has_role/is_member/current_user_id/my_institution_ids), memberships/profiles/enrolments/
guardian_students/audit_events schemas and RLS across 0001-0005, 0020.

No CRITICAL or HIGH findings.

## Findings

1. `src/modules/jobs/handlers/notify.announcement.ts:206-209` MEDIUM-leaning-LOW: the `announcement_audiences` select
   (service-role admin client) filters only by `announcement_id`, not by `institution_id`. Not currently exploitable —
   `announcement_id` comes from the job payload, which the handler already re-validated against `announcements` (status
   `published`) in the preceding query, and audience rows can only be created matching their parent announcement's
   `institution_id` (enforced by the `announcement_audiences_insert`/`_update` RLS `exists` checks in the migration). This
   is a defense-in-depth gap, not a demonstrated cross-tenant leak. Fix: add `.eq("institution_id", announcement.institution_id)`
   to the audiences query so the invariant doesn't have to be trusted implicitly.

2. `src/modules/jobs/handlers/notify.announcement.ts:36-65` vs `:111-161` LOW: inconsistent recipient-eligibility checks
   across audience types. `loadActiveMembers` (used for `school` and `role` audiences) notifies every membership with
   `status = 'active'`, with no check of `guardian_students.portal_access`; `guardiansAndStudents` (used for `grade`/
   `section` audiences) does check `portal_access = true`. A guardian whose portal access to all their children has been
   revoked, but whose membership row is still `active`, would still receive a `school`-wide or `role: guardian` broadcast.
   Likewise a `role: student` audience has no enrolment-active check, unlike `grade`/`section`. This may be intentional
   (role-identity broadcast vs per-student scoping are different concepts) but is worth confirming with product/ruling —
   flagging per the named "revoked portal_access ... still notified" risk since the two code paths disagree.

3. `src/modules/jobs/handlers/notify.announcement.ts:220-229` INFO, not a vulnerability: sequential
   `await createNotification(...)` per recipient in one job run. Already flagged in-code as an accepted shortcut
   ("fine up to ~5,000 recipients ... batch once a school audience grows past that"). Confirmed safe to retry: each
   `createNotification` call is idempotent per `(type, entityId, recipientUserId)` via the unique `data->>key` index, and
   `ensureDeliveryAttempts` backfills only missing channels — so a job that fails partway and retries does not double-send.
   Residual risk is purely throughput/job-timeout on a very large "school" audience tenant, already documented as a
   known tradeoff; no fix required by this review.

## What was checked and cleared

- **Non-manager read of announcement content**: `announcements_select` / `announcement_audiences_select` RLS (migration
  0068) both restrict to `owner`/`principal`/`admin` via `app.has_role`; recipients only ever see a `notifications` row
  (own-row RLS, `recipient_user_id = app.current_user_id()`, confirmed in 0020). No PostgREST path for a guardian/
  teacher/student to read the announcements tables directly.
- **Cross-institution audience targeting**: `announcement_audiences_insert`/`_update` RLS requires both `has_role` on the
  audience row's own `institution_id` AND an `exists` join back to the parent `announcements` row with matching
  `institution_id`, AND (when set) that `grade_id`/`class_section_id` belongs to that same `institution_id`. A manager
  cannot attach another institution's grade/section even by guessing its id — insert is rejected (42501), mapped to
  `validation_failed` in `announcements.actions.ts`.
  `src/modules/notifications/announcements.actions.ts:515-532`; migration lines ~956-998.
  All recipient-resolution queries in the job handler bind `institutionId` (sourced from the `announcements` row read by
  `id`, never from job payload beyond the id) except finding 1 above.
- **Job payload trust**: `notify.announcement` only reads `job.payload.announcement_id`; title/body/status/audiences are
  all re-read from current DB rows, matching the file's own header comment and the "never from the payload" rule.
- **Inactive memberships / revoked access / withdrawn students**: `status = 'active'` filtered everywhere on
  `memberships`; `enrolments.status = 'active'` filtered for grade/section audiences (excludes `withdrawn`/`transferred`/
  `completed`); `guardian_students.portal_access = true` filtered for grade/section audiences. See finding 2 for the one
  inconsistency (role/school audiences skip the portal_access check).
- **Preference bypass**: `notification.preferences.set` (`src/modules/notifications/announcements.actions.ts:561-593`)
  hardcodes `user_id: ctx.user.id` — cannot target another user's row; RLS (`notification_preferences_select/insert/update`)
  independently enforces `user_id = app.current_user_id()`. `disabledChannels` in `service.ts` never filters `in_app`
  (by design — opt-out is sms/email only per the table's own check constraint), so no silent full opt-out of in-app.
- **Publish/guard bypass**: `app.guard_announcements_update` (migration ~850-896) blocks any status change or edit of a
  non-draft row outside the transaction-local `app.allow_announcement_publish` GUC, which only `app.publish_announcement`
  sets, and even then only permits draft→published plus `published_at`/`published_by`, rejecting any other column change
  in the same statement. `app.publish_announcement` re-checks role, draft status, and ≥1 audience under `for update` row
  lock before flipping status, enqueuing the job (idempotency key `announcement:<id>`), and writing its own audit row —
  consistent with the existing 0009/0010 pattern. Audience edits after publish are blocked by the `exists (... a.status
  = 'draft')` clause in both `announcement_audiences_insert`/`_update` RLS policies.
- **Audit list cross-tenant/PII leakage**: `core.audit.list` (`src/modules/core/audit.queries.ts`,
  `src/modules/core/query-defs.ts`) is gated on permission `audit.read` (owner/principal/admin only, matching
  `audit_events_select` RLS scoped to `app.my_institution_ids`), filters every query by `ctx.institution.id`, and the
  `audit_events` select list is `id, institution_id, actor_user_id, action, entity_type, entity_id, created_at` only —
  no `before`/`after` columns are read, so no PII/diff leakage via this query. The secondary `profiles`/`memberships`
  lookups (actor name/role) run on the user's session client, so they are additionally bound by `profiles_select` (same-
  institution-membership) and `memberships_select` RLS — no cross-tenant actor data exposure.
- **DoS at scale**: see finding 3 — documented, retry-safe, not a security defect.
- **Permission matrix**: `announcement.manage` / `audit.read` / `notification.read` granted exactly to the roles the
  migration's own comments and `07 §2.2` describe (`src/lib/auth/permissions.ts`); every new action/query goes through
  `defineAction`/`defineQuery` → `guardedCall`, which resolves tenant context, Zod-validates input, and checks permission
  before the handler runs (pre-existing infra, confirmed still wired correctly for all three new actions + the query).
- **Secrets / SQL injection / XSS**: no hardcoded secrets; all new queries use the Supabase query builder (parameterized)
  with no string-concatenated SQL; no `innerHTML`/raw HTML rendering in this diff (UI not in scope/not present here).
