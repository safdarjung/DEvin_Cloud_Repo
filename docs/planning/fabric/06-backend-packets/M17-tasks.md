# M17 — Channels: Resend email adapter (D42)

Source: `07-master-plan-v1-v2.md` §3 M17, §2 D42. Migration: **none**. No new deps (Resend over `fetch`, no SDK). Owning module `src/modules/notifications` (owns `channels/*`, `service.ts`, `delivery_attempts` writes); `core.member.invite` (`src/modules/core/actions.ts`) is the one non-notification sender. Replaces fixture: none (no `src/modules/fabric/types.ts` / `core/demo/fixtures.ts` type covers channels).

Rulings:
- **One predicate.** `resendConfigured()` = `Boolean(process.env.RESEND_API_KEY)`, read per call (never at module load, so tests can `vi.stubEnv`). `emailChannel()` returns `resendEmail` when configured, else `simulatedEmail`. Both exported from `channels/resend.ts`; `service.ts` and `inviteMember` call `emailChannel()`. Nothing else reads the key.
- **Plain-node file.** `channels/resend.ts` is loaded by `pnpm jobs:run` via `service.ts`: relative `.ts` imports only, no `@/` value imports, no `server-only` (same constraint as `service.ts` header).
- **Wire format.** `POST https://api.resend.com/emails`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`, `User-Agent: coolskool`, `Idempotency-Key: <draft.idempotencyKey>` when present. Body `{ from, to: [toAddress], subject, text }`. `from` = `process.env.RESEND_FROM ?? "CoolSkool <onboarding@resend.dev>"` (Resend's test sender delivers only to the account owner, enough for the manual hosted check). Plain text only, never `html` (announcement bodies are user-authored). Verify header/body names with `docs-lookup`; if `Idempotency-Key` is unsupported, keep it (ignored header) and say so.
- **Result mapping (adapter never throws).** No `toAddress` → `{status:"failed", error:"no_contact"}`, no fetch. Reserved test domains (TLD `.test` `.example` `.invalid` `.localhost`, or domain `example.com|net|org`; RFC 2606/6761) → delegate to `simulatedEmail` (demo tenant `@demo.coolskool.test` stays simulated even on hosted with a key; no bounces). 2xx with `id` → `{status:"sent", provider:"resend", providerRef:id}`. 429 → wait `min(Retry-After, 2)` s (default 1 s), retry **once**, then failed. Other non-2xx → `{status:"failed", provider:"resend", error:"resend_http_<status>"}`. Network error / `AbortSignal.timeout(10_000)` → `error:"resend_network"`. Never put response body text or the address in `error` (lesson 10: Resend messages echo the address).
- **Draft shape.** `DeliveryAttemptDraft` gains `subject?: string` and `idempotencyKey?: string` (additive; simulated/in-app ignore them). Subject = template `title(lang)`; missing subject → `"CoolSkool"`.
- **Delivery status.** Written once, at send, into the existing `delivery_attempts` row (`status` sent|failed|simulated, `provider`, `provider_ref`, `error`). Table is immutable (`block_mutation`): no webhook status updates, no retry of a `failed` row (debt rows below). Idempotency key for notifications = `<notification_id>:email`, so a job retry after a crash between send and insert does not double-send.
- **Invite (not a notification).** `delivery_attempts.notification_id` is NOT NULL and the invitee has no user yet, so the invite email is **not** logged there; status goes in the action result `delivery: "sent"|"simulated"|"failed"` and the audit row `after: { role, delivery }` (no address, lesson 10). Sends only when `resendConfigured() && process.env.APP_URL`; otherwise `delivery: "simulated"` exactly as today. Link = `${APP_URL without trailing /}/invite#token=<token>` (fragment keeps the token out of server/proxy logs and Referer; the page that reads it is Workstream D). Email send failure never fails the action: invitation row stays, `ok:true`, `delivery:"failed"`. Idempotency key `invite:<invitation_id>`. EN only (invitee language unknown). The `token` stays in the result (existing contract).
- **Reminders.** No separate wiring: every template whose `channels` lists `email` goes through `emailChannel()` in `createNotification`. Today that is `enrolment_welcome`, `announcement`. If M12's `fee_reminder` template exists at T2 time and lacks `email`, T2 adds it (and its row in `tests/unit/notification-templates.test.ts`); M23 workflow reminders inherit this. SMS stays simulated (MSG91 is a later milestone).
- **Preferences.** Unchanged: `notification_preferences` email opt-out (0068) is applied before send, so an opted-out guardian gets no Resend call.
- **Badge flip = row status, not env.** UI shows `<SimulatedBadge />` per delivery row only when `status === "simulated"`; a `sent`/`failed` email row shows its status badge. Section-level badges ("Recent activity") render only when any shown row is simulated. Historic simulated rows keep their badge after the key is set (honest). Attendance "(SMS simulated)" text unchanged.
- **Tests never send real mail.** `vitest.config.mts` deletes `RESEND_API_KEY` after loading `.env.local`; tests that need it use `vi.stubEnv("RESEND_API_KEY", "re_test")` + a fetch spy that fakes only `https://api.resend.com/` and passes everything else through to the real fetch (supabase-js uses fetch): `const real = globalThis.fetch; vi.spyOn(globalThis, "fetch").mockImplementation((i, init) => String(i instanceof Request ? i.url : i).startsWith("https://api.resend.com/") ? Promise.resolve(Response.json({ id: "re_1" })) : real(i, init))`. Test recipients use a non-reserved domain (e.g. `@school-fixture.in`).
- **Permissions / ErrorCode / RLS.** No new permission keys, actions, queries, tables, definers or RLS. No new ErrorCode: email problems surface only as `delivery_attempts.status = 'failed'` / `delivery: "failed"`. No `all-actions.ts`, C-03, `query-defs.ts` or smoke-sample changes (no new names).
- **Env names** (`.env.example`, names only, rule 8): `RESEND_API_KEY` (optional; unset = simulated email), `RESEND_FROM` (optional sender, must be on a Resend-verified domain for real recipients). Never log either value.

Routing (owner: Sonnet + Haiku only): T1, T2, T3, T5 Sonnet; T4, T6 Haiku. Parallel: T1 ‖ T4 → T2 ‖ T3 → T5 → T6. No DB-migration owner needed; no task runs `db:reset`/`demo:reset`/`db:types`.

---

### Task 1: M17-T1 Resend channel adapter + selector
READ: BRIEF-COMMON.md; rulings; `src/modules/notifications/channels/{types,simulatedEmail}.ts`; `tests/unit/notification-templates.test.ts` (§"simulated channels never touch the network")
FILES: `src/modules/notifications/channels/resend.ts` (new); `src/modules/notifications/channels/types.ts` (edit: `subject?`, `idempotencyKey?`); `tests/unit/resend-channel.test.ts` (new); shared: `.env.example` (2 names + comments), `vitest.config.mts` (one line: `delete process.env.RESEND_API_KEY` after `loadDotEnvLocal()`, one-line why comment)
MIGRATION: none
EXPORTS: `resendConfigured(): boolean`; `resendEmail: Channel` (name `"email"`); `emailChannel(): Channel`.
TEST FIRST: `tests/unit/resend-channel.test.ts` — emailChannel is simulated and never calls fetch when RESEND_API_KEY unset; with key, sends one POST to api.resend.com with Bearer key, `to:[addr]`, subject, text, Idempotency-Key, and returns sent + providerRef; reserved `.test`/`example.com` address is simulated with no fetch; 500 → failed `resend_http_500`, error has no address; 429 then 200 → sent after exactly 2 calls (fake timers); fetch rejects → failed `resend_network`, no throw.
ACCEPT: `pnpm test tests/unit/resend-channel.test.ts tests/unit/notification-templates.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M17-T2 Notification service sends email through the selector
READ: BRIEF-COMMON.md; rulings; `src/modules/notifications/service.ts`; `tests/db/notifications.test.ts`, `tests/db/notify-announcement.test.ts` (fixture + admin client pattern)
FILES: `src/modules/notifications/service.ts` (edit: email via `emailChannel()` per call; pass `subject: title`, `idempotencyKey: \`${notificationId}:${channel}\``); `tests/db/notifications-email-channel.test.ts` (new); conditional: `src/modules/notifications/templates.ts` + its unit test only for the M12 `fee_reminder` ruling
MIGRATION: none
EXPORTS: no new exports; `createNotification` signature unchanged.
TEST FIRST: `tests/db/notifications-email-channel.test.ts` (own fixture institution, cleanup) — key unset → `announcement` email attempt `simulated`, Resend never called; key set → attempt `sent`, `provider='resend'`, `provider_ref` = faked id, Resend body subject = template title; guardian with email opt-out (0068) → no email attempt and no Resend call; Resend 500 → attempt `failed`, `error='resend_http_500'`, in_app attempt still written; rerun of the same notification → no second Resend call (attempt exists).
ACCEPT: `pnpm test:db tests/db/notifications-email-channel.test.ts tests/db/notifications.test.ts tests/db/notify-announcement.test.ts`; `pnpm test tests/unit/notification-templates.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M17-T3 `core.member.invite` sends the invite email
READ: BRIEF-COMMON.md; rulings (Invite); `src/modules/core/actions.ts` (`inviteMember`); `tests/db/member-invite-actions.test.ts`
FILES: `src/modules/core/actions.ts` (edit `inviteMember` only; email text built by a non-exported helper in the same file — `"use server"` exports async functions only); `tests/db/member-invite-actions.test.ts` (extend)
MIGRATION: none
EXPORTS: `core.member.invite` result `{ invitationId, token, delivery: "sent" | "simulated" | "failed" }`; audit `after: { role, delivery }`.
TEST FIRST: key + APP_URL set → `delivery:"sent"`, one Resend call `to:[invitee]`, text contains school name, role and `/invite#token=<token>`, Idempotency-Key `invite:<id>`; key unset → `delivery:"simulated"`, no Resend call (existing assertion still green); APP_URL unset with key → `simulated`; Resend 500 → `ok:true`, `delivery:"failed"`, invitation row exists; audit row has `delivery`, no email address.
ACCEPT: `pnpm test:db tests/db/member-invite-actions.test.ts tests/db/onboarding-journey.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M17-T4 Badge flips on delivery status (Haiku)
READ: BRIEF-COMMON.md; rulings (Badge flip); `src/modules/notifications/components/MessageLog.tsx`; `src/components/honesty.tsx`
FILES: `src/modules/notifications/components/MessageLog.tsx` (status badge for non-simulated rows, `<SimulatedBadge />` only when `row.status === "simulated"`); `src/app/(tenant)/[institution]/dashboard/page.tsx` (line ~584: `badge` only when `(data.recentActivity ?? []).slice(0, 8).some((e) => e.status === "simulated")`); `tests/unit/delivery-badge.test.ts` (new, `.ts` — use `createElement` + `renderToStaticMarkup` from `react-dom/server`, no JSX); shared comment-only edits: `src/modules/core/components/dashboard/RecentActivity.tsx` (same `some()` condition + header comment), `src/modules/notifications/queries.ts` (C-31 doc comment: email rows may be `sent` with Resend)
MIGRATION: none
EXPORTS: none new.
TEST FIRST: MessageLog with one `email/sent` row and one `sms/simulated` row renders "Simulated" exactly once and "Sent" once; all-simulated rows render one badge per row (unchanged behaviour).
ACCEPT: `pnpm test tests/unit/delivery-badge.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M17-T5 Email acceptance over HTTP
READ: BRIEF-COMMON.md; rulings; `tests/db/announcements-acceptance.test.ts` (HTTP + `runOnceCore` pattern), `tests/db/member-invite-actions.test.ts`
FILES: `tests/db/email-channel-acceptance.test.ts` (new)
MIGRATION: none
TEST: with `RESEND_API_KEY` stubbed + passthrough fetch spy: admin `POST /api/v1/actions/core.member.invite` → 200, `delivery:"sent"`, Resend called once; admin creates + publishes a school-wide announcement over HTTP, runner runs once → guardian (non-reserved email) has an email `delivery_attempts` row `sent`/`resend`, a `.test`-address guardian's row is `simulated`; admin `GET /api/v1/query/notifications.listDeliveryLog` lists both statuses; job rerun → no extra Resend call. Key unstubbed → same flow yields only `simulated` and zero Resend calls.
ACCEPT: `pnpm test:db tests/db/email-channel-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M17-T6 Docs (Haiku)
READ: rulings; T1–T5 reports (`06-backend-packets/M17-T<k>-report.md`) for debt the tasks named
FILES (docs only): `docs/planning/coolskool/10-backlog-index.md` §3 (note after the 0064–0089 line: "M17 Resend email adapter — no migration, built"); `docs/planning/coolskool/07-security-and-ai-governance.md` (§4: no definer/service-role row added — add one line under the table: "M17: no new definer; outbound email to Resend only when `RESEND_API_KEY` set, plain text, reserved test domains never sent"; §1 threat table: one row "PII egress to email provider" → mitigations per rulings, test `tests/unit/resend-channel.test.ts`); `docs/planning/coolskool/06-workflows-and-contracts.md` §3 (email channel cells: "email (Resend when `RESEND_API_KEY` set, else sim)"); `docs/planning/coolskool/03-feature-matrix.md` F-COM-02 / F-COM-05 (email live when key set, SMS sim; badge per row) and `08-testing-and-acceptance.md` C-31 text to match; `docs/planning/fabric/03-roadmap-and-tracker.md` (no FB row covers channels — change nothing, say so in the report); `docs/planning/coolskool/11-operations.md` (onboarding runbook: set `RESEND_API_KEY` + `RESEND_FROM` on Vercel, verify the sender domain in Resend, manual hosted check = invite your own address → `delivery:"sent"` + Resend dashboard entry; never set the key in `.env.local` used for e2e unless intended); `docs/planning/coolskool/12-decision-log.md` §Debt — next free DBT numbers: (a) no delivered/bounced tracking (Resend webhooks need an append-only `delivery_events` table), (b) `failed` email attempts are never retried (`delivery_attempts` immutable), (c) announcement email fan-out is sequential at Resend's ~2 req/s — large schools can exceed the job time budget; move to `/emails/batch`, (d) invite emails are not in `delivery_attempts` (needs nullable `notification_id` or an `invitation_id` column), (e) `/invite#token=` accept page not built (Workstream D), plus any debt T1–T5 reports name.
ACCEPT: `pnpm lint` (no code touched)
REPLACES FIXTURE: none

---

Controller after T5: security review (Sonnet) on the M17 diff (egress, PII in errors/audit, key never logged, reserved-domain guard); full gate `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm test:security`; commit/push; owner sets `RESEND_API_KEY`/`RESEND_FROM` on Vercel and does the manual hosted send; `DONE M17 <sha>`.
