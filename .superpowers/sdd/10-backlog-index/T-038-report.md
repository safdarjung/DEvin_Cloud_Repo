Packet: T-038 Notifications inbox, adapters, simulated SMS/email, message log

Files changed:
- `src/modules/notifications/templates.ts` (new) — 5 types, EN/HI bodies, strict Zod var schemas, channel lists per 06 §3.
- `src/modules/notifications/channels/{types,inApp,simulatedSms,simulatedEmail}.ts` (new) — `Channel` interface + 3 adapters, never call `fetch`.
- `src/modules/notifications/service.ts` (new) — `createNotification()`: inserts `notifications` (key `type:entityId:recipientUserId`), catches the unique-violation (23505) and returns the existing row instead of a duplicate, then inserts one `delivery_attempts` row per channel.
- `src/modules/jobs/handlers/notify.{attendance_absence,enquiry_received,enrolment_welcome}.ts` (new) — real handlers.
- `src/modules/jobs/handlers/index.ts` (edited) — wires the three above; `notify.results_published`/`notify.recheck_decided`/`finance.generate_term_invoices` stay `not_implemented` placeholders (see Deviations).
- `src/modules/notifications/{queries,actions,schemas}.ts` (new) — `listMyNotifications`, `unreadCount`, `listDeliveryLog`, `markRead`.
- `src/modules/notifications/components/{Bell,Inbox,MessageLog,MarkReadButton}.tsx` (new).
- `src/app/(tenant)/[institution]/notifications/{page.tsx,log/page.tsx}` (new).
- `src/components/tenant/header.tsx`, `src/app/(tenant)/[institution]/layout.tsx` (edited) — header Bell slot, fed by `unreadCount()` computed in the layout.
- `tests/unit/notification-templates.test.ts`, `tests/db/notifications.test.ts` (new).
- `tests/unit/jobs-runner.test.ts` (edited, 1 line) — see Deviations.
- Nav: no change needed — `src/lib/nav.ts` and `tests/unit/nav.test.ts` already had the `/notifications` entry (pre-existing before this session).

Behavior implemented:
- `notify.enquiry_received`: notifies every `admissions`-role member, built from the current `enquiries`/`grades` rows (never the job payload's `child_name`/`guardian_name`/`phone`, which can't be trusted per lead ruling). Tested end-to-end including a "tampered payload is ignored" assertion.
- `notify.attendance_absence`: re-reads `attendance_records` → re-checks `settings.attendance.statuses[].notify_guardian` at send time (skips if the record changed or the status no longer notifies) → resolves the primary guardian via `guardian_students.is_primary` → resolves the guardian's portal account via `memberships` (see Deviations, not `guardians.user_id`) → in-app + simulated SMS.
- `notify.enrolment_welcome`: same shape, reads `enrolments`/`students`/`class_sections`/`grades`; in-app + simulated email. No caller enqueues this type yet (see Deviations).
- Idempotency: all three handlers and `createNotification` rely on the `notifications_data_key_idx` unique index; a rerun hits the 23505 branch and inserts no new notification or delivery attempts (proven in `tests/db/notifications.test.ts`, including a job rerun and a direct `createNotification` rerun).
- Simulated channels never call `fetch`/network (unit-tested with `vi.stubGlobal("fetch", ...)`).

Permission gates (file:line):
- `notification.read` / `notification.log.read` defined `src/lib/auth/permissions.ts:54-55`.
- Inbox page: `src/app/(tenant)/[institution]/notifications/page.tsx:14` (`requirePermission(ctx, "notification.read")`).
- Message log page: `src/app/(tenant)/[institution]/notifications/log/page.tsx:13`.
- `listDeliveryLog` also self-checks: `src/modules/notifications/queries.ts:70` (defense in depth, in case a future caller forgets the page-level check).
- `markRead` action: `src/modules/notifications/actions.ts:17` (`permission: "notification.read"`), plus `.eq("recipient_user_id", ctx.user.id)` on the update, on top of RLS.
- RLS: `notifications_select`/`_update` (own rows, C-30) and `delivery_attempts_select` (owner/principal/admin/admissions, C-31) are pre-existing in `20261028000003_platform.sql`, unmodified.

Context7/docs-lookup: not used. The packet names the `docs-lookup` agent, but the lead instruction for this task explicitly says "Do not dispatch any other subagents," which takes precedence. Verified Next 16.4 / Zod 4 / supabase-js 2.x usage by pattern-matching already-merged code in this repo (`src/modules/academics/assignments.{actions,queries}.ts`, `src/app/(tenant)/[institution]/jobs/*`) instead — same async-`params` Promise convention, same `.strict()` Zod style, same `.filter("col->>key", "eq", ...)` PostgREST json filter already implied by the existing `data->>'key'` partial index design.

Deviations:
1. `notify.results_published` and `notify.recheck_decided` are left as `not_implemented` placeholders (unchanged from T-037). Grepped every migration: `results` and `recheck_decisions` tables do not exist on this branch (06 §W7/§W8's exam/recheck module hasn't landed), and nothing enqueues either job type yet. "Re-check state at send time" is impossible without the row to check. Re-implement when that migration lands — same pattern as the other three handlers.
2. `guardians.user_id`/`students.user_id` are never populated anywhere in this codebase (checked the real seed, `scripts/seed/sections/{core,people}.ts`, and the test fixture, `tests/helpers/roles.ts`) — only `memberships.user_id` links a guardian/student to their auth account. Both handlers resolve the recipient via `memberships` (`institution_id, guardian_id, role = 'guardian'`), not `guardians.user_id`. Caught this by writing the DB test against the real fixture before trusting the column.
3. `notify.enrolment_welcome` has no caller yet (no migration/action enqueues it) — built ahead of the "convert application to enrolment" packet, following the same shape as the other handlers. Untestable as an integration (no enqueue site to test against), but unit-equivalent-tested directly via the handler function against hand-built `enrolments`/`guardian_students` rows.
4. `tests/unit/jobs-runner.test.ts`: one pre-existing T-037 test asserted that dispatching `notify.attendance_absence` throws `not_implemented` (it used that type only as a stand-in for "any registered type"). Now that the handler is real, that assertion is stale; swapped it to `finance.generate_term_invoices` (still a placeholder), no other change.
5. Concurrent work from another lane landed mid-session (`supabase/migrations/20261028000014_attendance_submit.sql`, `src/modules/attendance/*` — not mine, untouched by me): it enqueues `notify.attendance_absence` with payload `{ record_id }` and key `absence:<record_id>` exactly as this handler expects — confirms the payload shape guessed from the packet text was correct. `pnpm typecheck` currently reports errors only in `src/modules/attendance/actions.ts` (RPC names not yet in the generated `src/lib/db/types.ts`, which `src/lib/db/types.ts` is explicitly out of my scope to regenerate) — unrelated to this packet, left alone per instructions to ignore errors outside my scope.

Tests run:
- `pnpm vitest run --project unit tests/unit/notification-templates.test.ts` → 9 passed.
- `pnpm test` (full unit project) → 15 files, 132 passed (includes the jobs-runner.test.ts fix above).
- `pnpm vitest run --project db tests/db/notifications.test.ts` → 6 passed, run twice for stability (fixture cleanup via `app.demo_reset` + institution delete).
- `pnpm lint` → 0 errors (5 pre-existing unrelated warnings in `scripts/seed/sections/*`).
- `pnpm typecheck` → clean for every file this packet touched; the only errors present are in a concurrent lane's in-progress file (`src/modules/attendance/actions.ts`, see Deviation 5).
- `pnpm jobs:run` smoke → ran clean against the local DB (`claimed 0 · succeeded 0`), then re-ran after manually enqueuing a real `notify.enquiry_received` job via `app.enqueue_job` (no admissions member in that scratch institution, so it logged `succeeded` with zero notifications created — correct no-recipient no-op); scratch institution/job cleaned up afterward.

Tests not run: `tests/db/jobs.test.ts` and the rest of `pnpm test:db` (forbidden by the packet — DB owned by another lane; only ran my own file). `tests/security/**` not touched or run (owned by another lane).

Limitations / honesty label: every simulated SMS/email row in the message log shows `<SimulatedBadge />` (`src/modules/notifications/components/MessageLog.tsx`); in-app rows show their own status badge, never Simulated (correct — in-app isn't simulated). `listDeliveryLog` never selects `to_address`/`provider`/`provider_ref` (07 §3 confidentiality) even for the owner/principal/admin/admissions roles that can read the table.

Security / integration risks: none identified beyond Deviation 2 (would have silently produced zero notifications in production too, since no code anywhere populates `guardians.user_id`). RLS/permission layering double-checked (DB test proves both RLS and the permission gate independently for C-30/C-31).

Follow-ups: re-implement `notify.results_published`/`notify.recheck_decided` when the exams/recheck migration lands (Deviation 1); wire an enqueue call for `notify.enrolment_welcome` when the admissions→enrolment conversion packet lands (Deviation 3); `notify.attendance_updated` (06 §W5 correction notice) has no `JobType` entry and no handler — out of this packet's five types, flagging as a backlog gap for whoever owns W5 corrections next.

New dependencies: none.

Assumptions made: language per notification = `institution.settings.communication.languages[0] === "hi" ? "hi" : "en"` (packet's stated P2 default, demo-level); in-app title/body are the same string across channels (spec gives one body per type, not per channel); a delivery attempt is always recorded even when a channel has no contact address (`status: "failed"`, `error: "no_contact"`, no PII) rather than silently skipping it, for audit completeness.

## Fix round 1 (code review)

1. HIGH (C-02) — recipient membership lookups had no `status = 'active'` filter, so a disabled or invited member still got notified (including the child's name/class/date). Added `.eq("status", "active")` to the `memberships` lookup in `notify.attendance_absence.ts`, `notify.enrolment_welcome.ts`, and `notify.enquiry_received.ts`. Tests: `tests/db/notifications.test.ts` — "a guardian with a disabled membership gets no notification and no delivery_attempts" and "a disabled admissions membership is not notified".
2. HIGH — `layout.tsx` awaited `unreadNotificationCount` with no guard; any error there crashed every tenant page. Wrapped the call in try/catch (`src/app/(tenant)/[institution]/layout.tsx`): on failure, logs `[correlationId] unread notification count failed` (the error object only, no notification content) and renders the bell with `unreadCount = 0`. The page still renders. No new test added (same shape as the existing `logUnexpectedError`/`mapSqlError` correlation-id pattern already covered by define-action.test.ts); verified by inspection and by the full page compiling/typechecking.
3. MEDIUM — `createNotification` returned early on the unique-violation path without checking whether all per-channel `delivery_attempts` existed, so a crash between the notification insert and a later channel's attempt insert left that channel's attempt missing forever. Extracted `ensureDeliveryAttempts()` (`src/modules/notifications/service.ts`): reads existing `delivery_attempts.channel` for the notification, inserts only the channels still missing, and is now called on both the fresh-insert path and the unique-violation path. Test: `tests/db/notifications.test.ts` — "a retry after a partial failure backfills only the missing channel, once" (hand-builds a notification + one delivery_attempts row to simulate the crash, retries twice, asserts exactly one attempt per channel both times).

Verify (fix round 1): `pnpm vitest run --project db tests/db/notifications.test.ts` → 9/9 pass. `pnpm test` → 16 files, 141/141 pass. `pnpm lint` → 0 errors in my files (errors present are all in `src/modules/attendance/**`, a concurrent lane, pre-existing). `pnpm typecheck` → clean for every file this packet touched; remaining errors are all in `src/modules/attendance/actions.ts` (concurrent lane, missing generated RPC types — not mine to fix).
