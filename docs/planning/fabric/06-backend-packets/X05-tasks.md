# X05 — WhatsApp channel adapter (plug-and-play module `whatsapp`)

Source: owner directive 2026-11-02 (extension X05 "WhatsApp channel adapter", owner-approved); D42 (WhatsApp only through an authorised BSP); D45 module system (`MOD-tasks.md`). Migration `20261028000089_whatsapp_channel.sql` (claimed in `10-backlog-index.md` §3, 2026-11-02). It cannot be avoided: two `channel` check constraints must accept `whatsapp`, and the MOD drift rule puts every new key in `app.module_catalog`. No new deps (MSG91 over `fetch`, no SDK). Owning module folder `src/modules/notifications` (`channels/*`, `service.ts`, `templates.ts`). Module key `whatsapp` (category Communication, default on, no `requires`). Replaces fixture: none (`whatsapp-sim` entries in `src/modules/fabric/demo/{data,marketplace}.ts` stay V3 fixtures).

Prerequisites: MOD merged (catalog, `0084`, MOD-T11 channel gate in `service.ts`, `module` required), M17 merged (`emailChannel()` selector pattern, fetch-spy test pattern), M12 merged (`fee_reminder` template; `0074` owns the preference **category** check). If M12 has not merged, drop every `fee_reminder` item below and say so.

Rulings:
- **Provider: MSG91 only.** D42 already names MSG91 for SMS, so one Indian account covers both, and its API takes template name + language + positional params. That is the approved-template model. Gupshup is not built.
- **One predicate.** `whatsappConfigured()` = `Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_WA_NUMBER)`, read per call. `whatsappChannel()` → `msg91WhatsApp` when configured, else `simulatedWhatsApp`. A future SMS adapter can set `MSG91_AUTH_KEY` alone without turning WhatsApp live.
- **Plain-node file.** `channels/whatsapp.ts` is loaded by `pnpm jobs:run` via `service.ts`. Use relative `.ts` imports only, no `@/` value imports, no `server-only`.
- **Wire format.** `POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`. Headers: `authkey: <MSG91_AUTH_KEY>`, `Content-Type: application/json`, `Accept: application/json`. Body: `{ integrated_number: MSG91_WA_NUMBER, content_type: "template", payload: { messaging_product: "whatsapp", type: "template", template: { name, language: { code: lang, policy: "deterministic" }, namespace?: MSG91_WA_NAMESPACE (only when set), to_and_components: [{ to: [msisdn], components: { body_1: { type: "text", value }, … } }] } } }`. Timeout: `AbortSignal.timeout(10_000)`. Check the names with `docs-lookup` (MSG91 WhatsApp bulk template API). If they differ, use the documented names, keep these semantics, and record the actual names in the report.
- **Result mapping (the adapter never throws).**
  - No `toAddress` → `failed`/`no_contact`. Number not normalisable → `failed`/`invalid_phone`. No `draft.template` → `failed`/`no_template`. None of these three calls fetch.
  - 2xx with JSON `hasError !== true` → `{ status: "sent", provider: "msg91", providerRef: typeof request_id === "string" ? request_id : null }`.
  - 2xx with `hasError: true` → `failed`/`msg91_rejected`. Other non-2xx → `failed`/`msg91_http_<status>`, no retry. Throw, timeout or bad JSON → `failed`/`msg91_network`.
  - Never put the number, the key or response text in `error` (lesson 10).
- **India number.** `toMsisdn(phone)`: strip spaces, `-`, `(`, `)` and a leading `+`. `^[6-9]\d{9}$` → prefix `91`. `^0[6-9]\d{9}$` → drop the `0`, prefix `91`. `^91[6-9]\d{9}$` → keep. Anything else → `null`. Guardian phones are already `^[6-9][0-9]{9}$` (0004 check). Staff phones are free text.
- **Address.** The WhatsApp `toAddress` is `contacts.sms`, the same mobile the handlers already resolve from current rows. No handler edits and no new contacts key.
- **Demo safety.** Seed phones (`98000…`) are real-format Indian numbers. When `institutions.is_demo = true`, `service.ts` always uses `simulatedWhatsApp`, even with the key set. Read `is_demo` in the institutions select that MOD-T11 added for `settings` (one read per `createNotification`).
- **Which templates.** Every template whose `channels` lists `sms` gains `whatsapp` right after `sms`: `attendance_absence`, `results_published`, `recheck_decided`, `announcement`, `fee_reminder`. `enquiry_received` (staff, in-app) and `enrolment_welcome` (handler passes only an email) do not.
- **Approved templates.** One Meta template per type, named `coolskool_<type>`, languages `en` and `hi` (Meta codes), category Utility. Param order is `WHATSAPP_PARAMS[type]`:
  - `attendance_absence` [student, class, date, school]
  - `results_published` [student, exam, school]
  - `recheck_decided` [student, subject, decision, marks, school]
  - `announcement` [title, excerpt]
  - `fee_reminder` [student, invoice_no, amount, due_on, school]
- **Template text.** Message text = `${HEADING[lang]}\n${body}\n\n${CLOSING[lang]}`. HEADING: en `School update`, hi `स्कूल अपडेट`. CLOSING: en `Details are in the CoolSkool app.`, hi `विवरण CoolSkool ऐप में देखें।`. Here `body` is the existing bilingual template body. Meta rejects a body that starts or ends with a variable, and every current body ends with `-{school}` or `{excerpt}`.
  - Approval text = the same function with the param keys replaced by `{{1}}…{{n}}`. Ops submits it verbatim.
- **Params.** Each param: `String(v).replace(/\s+/g, " ").trim().slice(0, 300) || "-"`. Meta rejects newline, tab, more than 4 spaces and empty params. The logged `rendered_body` is the text rendered from these sanitized params. Amounts arrive pre-formatted (`₹12,345.00`, M12).
- **Delivery log.** `delivery_attempts` gets one `whatsapp` row per notification and recipient, written once at send. Provider is `msg91` or `simulated-whatsapp`; the table stays immutable.
  - Rerun safety = the existing "attempt already exists for this channel" check. MSG91 has no idempotency key, so a crash between send and insert can double-send (debt).
- **Opt-out.** `notification_preferences.channel` gains `whatsapp`. Same model as sms/email: a missing row means on, an `enabled = false` row turns it off per category. The existing `disabledChannels()` applies it unchanged.
  - Opt-in/consent (Meta policy, DPDP Act 2023) is the school's job on its admission form. The product records opt-out only (debt).
- **Module.** `whatsapp` off → the channel is not attempted: no `delivery_attempts` row and no fetch. This uses MOD-T11's channel→module check, with `whatsapp` added. `notification.preferences.set` with `channel: "whatsapp"` while the module is off → `forbidden` + `MODULE_DISABLED_MESSAGE` (first line of the handler, `AppError`). This is the one "module disabled → forbidden" test. Data is kept.
- **Tables / RLS / permissions.** No new tables, policies, definers or grants. `0089` only widens the two check constraints and inserts `whatsapp` into `app.module_catalog`; `app.module_enabled` (MOD, 0084) is never redefined. No new permission keys and no `07 §2.2` change: preferences stay `notification.read`, own rows.
- **ErrorCode.** None new. Unknown channel → `validation_failed` (Zod). Module off → `forbidden`. Provider problems appear only as `delivery_attempts.status = 'failed'` plus the error strings above.
- **Honesty (rule 7).** `MessageLog` already shows `<SimulatedBadge />` on every `status = 'simulated'` row (M17-T4), so WhatsApp rows inherit it. The catalog description says "simulated until the provider key is set". F-COM-04 is `sim`.
- **India specifics.** DLT/TRAI sender rules apply to SMS, not WhatsApp: `settings.communication.sms_sender` is untouched. Hindi goes out only when a handler passes `lang: "hi"`, and none does today; this limitation is shared with SMS (debt). No quiet hours.
- **Env** (names only in `.env.example`; never log values):
  - `MSG91_AUTH_KEY` (shared with the future SMS adapter).
  - `MSG91_WA_NUMBER` (integrated WhatsApp number, digits with `91`).
  - `MSG91_WA_NAMESPACE` (optional).
- **Tests never send.**
  - `vitest.config.mts` deletes `MSG91_AUTH_KEY` after loading `.env.local`.
  - Tests use `vi.stubEnv` plus the M17 passthrough fetch spy, faking only `https://api.msg91.com/` with `Response.json({ hasError: false, request_id: "wa_1" })`.
  - Fixture institutions keep `is_demo = false` unless the case is about the demo guard.
- **Registries.** No new action or query names, so `all-actions.ts`, C-03, `query-defs.ts`, `all-queries.ts` and smoke samples are unchanged. `tests/security/module-gate.test.ts` needs nothing.

Skipped (smallest version): Gupshup; inbound webhook (STOP keyword, delivered/read receipts); per-school WABA/number (one deployment-wide sender); consent record/UI; guardian language column; media/header/button templates; free-form 24 h session messages; `/settings/modules` live/simulated badge (row badges + description cover rule 7); batching via the bulk `to` array; retries.

Routing: T1 sonnet exclusive [] ; T2 sonnet none [] ; T3 sonnet tests [1,2] ; T4 sonnet tests [1] ; T5 sonnet tests [3,4] ; T6 sonnet exclusive [3] ; T7 haiku none [5,6]

Seed-/runner-imported files: relative `.ts` imports only. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`).

---

### Task 1: X05-T1 Module key `whatsapp` + migration 0089 (Sonnet, DB owner)
READ: BRIEF-COMMON.md (lessons 3–5); rulings (Module, Tables); `src/lib/modules/catalog.ts`; the `app.module_catalog` definition (0084, MOD); `supabase/migrations/20261028000068_announcements.sql` (preferences) and `…0003_platform.sql` (`delivery_attempts`); `tests/db/module-enabled-sql.test.ts`
FILES: `supabase/migrations/20261028000089_whatsapp_channel.sql` (new); `src/lib/modules/catalog.ts` (one entry); `tests/db/whatsapp-channel-sql.test.ts` (new); shared: `tests/unit/modules-catalog.test.ts` (entry count/order only), `src/lib/db/types.ts` (run `pnpm db:types`; expect zero diff because check constraints are not in generated types; say so)
MIGRATION: `20261028000089_whatsapp_channel.sql` (claimed)
EXPORTS: catalog `whatsapp: { label: "WhatsApp", category: "Communication", description: "Sends parent alerts on WhatsApp through MSG91 approved templates; simulated until the provider key is set.", default: true }`, placed right after `sms`. The settings schema follows automatically through `OPTIONAL_MODULE_KEYS`; check it. Migration: (1) drop and re-add the `delivery_attempts` channel check as `('in_app','sms','email','whatsapp')`; (2) do the same for the `notification_preferences` channel check as `('sms','email','whatsapp')`. Get both constraint names from `pg_constraint` and leave the category check alone (M12 owns it). (3) `insert into app.module_catalog (key, default_enabled) values ('whatsapp', true) on conflict (key) do update set default_enabled = excluded.default_enabled`.
TEST FIRST: a guardian upserts their own `whatsapp` preference over PostgREST → ok; channel `telegram` → 23514; the admin client inserts a `whatsapp` delivery_attempts row → ok; `app.module_enabled(inst, 'whatsapp')` (postgres client) → true for `{}`, false for `{modules:{whatsapp:false}}`; the drift test stays green without edits (it iterates `MODULE_KEYS`).
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/whatsapp-channel-sql.test.ts tests/db/module-enabled-sql.test.ts`; `pnpm test tests/unit/modules-catalog.test.ts`; `pnpm test:security tests/security/grants.test.ts tests/security/module-gate.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 2: X05-T2 MSG91 WhatsApp adapter + template map (Sonnet)
READ: BRIEF-COMMON.md; rulings; `src/modules/notifications/channels/{resend,simulatedSms,types}.ts`; `src/modules/notifications/templates.ts`; `tests/unit/resend-channel.test.ts` (fetch-spy pattern)
FILES: `src/modules/notifications/channels/whatsapp.ts` (new); `src/modules/notifications/templates.ts` (edit; do **not** change channel lists here, T3 does); `tests/unit/whatsapp-channel.test.ts` (new); shared: `src/modules/notifications/channels/types.ts` (`template?: { name: string; lang: Lang; params: string[] }`, WhatsApp-only comment), `.env.example` (3 names + one-line comments), `vitest.config.mts` (`delete process.env.MSG91_AUTH_KEY` beside the RESEND line)
MIGRATION: none
EXPORTS: templates — `NotificationChannel` gains `"whatsapp"`; `WhatsAppType` (the 5 types); `WHATSAPP_PARAMS` per rulings, typed `{ readonly [T in WhatsAppType]: readonly (keyof VarsFor<T> & string)[] }`; `whatsappMessage<T extends WhatsAppType>(type: T, vars: VarsFor<T>, lang: Lang): { template: { name: string; lang: Lang; params: string[] }; text: string }`; `whatsappApprovalText(type: WhatsAppType, lang: Lang): string`. whatsapp.ts — `whatsappConfigured()`, `toMsisdn(phone: string): string | null`, `simulatedWhatsApp: Channel` (no contact → `failed`/`no_contact`, else `simulated`/`simulated-whatsapp`, never fetch), `msg91WhatsApp: Channel`, `whatsappChannel(): Channel`.
TEST FIRST: unset key, or key without number → simulated and no fetch; configured → one POST to the MSG91 URL with an `authkey` header, `integrated_number`, name `coolskool_attendance_absence`, `language {code:"hi",policy:"deterministic"}`, `to:["919800000001"]`, `body_1…body_4` in order → `sent` + providerRef `wa_1`; `toMsisdn` accepts `9876543210`, `+91 98765-43210`, `09876543210`, `919876543210` (all → `919876543210`) and rejects `12345` and `5876543210`; invalid phone → `invalid_phone` with no fetch; 500 → `msg91_http_500` with no number digits in `error`; 200 + `hasError:true` → `msg91_rejected`; fetch rejects → `msg91_network` with no throw; params collapse `\n`/`\t`, empty → `-`, length capped at 300; `whatsappApprovalText` for every type × en/hi uses `toMatchInlineSnapshot()` (T7 copies these) and none starts or ends with `{{`; every `WHATSAPP_PARAMS[t]` has exactly the same key set as `NOTIFICATION_TEMPLATES[t].varsSchema` keys.
ACCEPT: `pnpm test tests/unit/whatsapp-channel.test.ts tests/unit/notification-templates.test.ts tests/unit/resend-channel.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 3: X05-T3 Notification service sends WhatsApp
READ: BRIEF-COMMON.md; rulings (Address, Demo safety, Which templates, Delivery log, Opt-out, Module); `src/modules/notifications/service.ts` (incl. MOD-T11 gate); T2 exports; `tests/db/notifications-email-channel.test.ts` (fixture + fetch spy)
FILES: `src/modules/notifications/service.ts`; `src/modules/notifications/templates.ts` (add `"whatsapp"` after `"sms"` in the 5 channel lists); `tests/db/notifications-whatsapp-channel.test.ts` (new); expectation-only edits, each named in the report: `tests/unit/notification-templates.test.ts` (channel lists; add `simulatedWhatsApp` to "simulated channels never touch the network"), `tests/db/notifications.test.ts` (~116, ~305), `tests/db/notify-results-published.test.ts` (~141)
MIGRATION: none
EXPORTS: no new exports; `createNotification` signature unchanged. `channelFor` returns `simulatedWhatsApp` for a demo institution, else `whatsappChannel()`. WhatsApp `toAddress` = `contacts.sms`. When the channel list includes `whatsapp`, `createNotification` computes `whatsappMessage(type, vars, lang)` once: the draft gets `template`, and `rendered_body` gets `.text` for the whatsapp row only. Add `whatsapp` to the channel→module map. Read `is_demo` in the existing settings select. Update the `disabledChannels` comment (0089 allows `whatsapp`).
TEST FIRST (own fixture institution, cleanup):
- Key unset → an announcement gives in_app + sms + whatsapp attempts; whatsapp is `simulated`/`simulated-whatsapp`; zero MSG91 calls.
- Key + number stubbed → `sent`, `provider='msg91'`, `provider_ref='wa_1'`, `to_address` = guardian phone, `rendered_body` starts with `School update`.
- Guardian with `whatsapp` opt-out for `announcement` → no whatsapp attempt, sms attempt present, zero calls.
- `settings.modules.whatsapp=false` → no whatsapp attempt, zero calls.
- `is_demo=true` + key → `simulated`, zero calls.
- MSG91 500 → `failed`/`msg91_http_500`, in_app present.
- Rerun → no second call.
ACCEPT: `pnpm test:db tests/db/notifications-whatsapp-channel.test.ts tests/db/notifications.test.ts tests/db/notify-announcement.test.ts tests/db/notify-results-published.test.ts tests/db/notifications-email-channel.test.ts tests/db/module-jobs-channels.test.ts`; `pnpm test tests/unit/notification-templates.test.ts tests/unit/whatsapp-channel.test.ts tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 4: X05-T4 WhatsApp preference + delivery-log type (Sonnet)
READ: BRIEF-COMMON.md; rulings (Opt-out, Module, ErrorCode); `src/modules/notifications/announcements.{schemas,actions}.ts` (`setNotificationPreference`); `tests/db/announcement-actions.test.ts` (preference cases)
FILES: `src/modules/notifications/announcements.schemas.ts` (`PREFERENCE_CHANNELS` gains `"whatsapp"`; keep the "mirrors 0068" comment accurate: 0068 + 0089); `src/modules/notifications/announcements.actions.ts` (first line of the handler: `if (input.channel === "whatsapp" && !isModuleEnabled(ctx, "whatsapp")) throw new AppError("forbidden", MODULE_DISABLED_MESSAGE);`); `tests/db/whatsapp-preferences.test.ts` (new); shared: `src/modules/notifications/queries.ts` (`DeliveryLogRow.channel` union gains `"whatsapp"`)
MIGRATION: none
EXPORTS: no new names. `notification.preferences.set` accepts `channel: "whatsapp"`.
TEST FIRST: guardian sets `{category:"announcement", channel:"whatsapp", enabled:false}` → ok, row stored, audit row has no phone; same input with the whatsapp module off → `forbidden` + exact `MODULE_DISABLED_MESSAGE`, no row; `sms` preference with the whatsapp module off → ok; `channel:"telegram"` → `validation_failed`; admin `listDeliveryLog` returns a `whatsapp` row typed through.
ACCEPT: `pnpm test:db tests/db/whatsapp-preferences.test.ts tests/db/announcement-actions.test.ts`; `pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: X05-T5 Acceptance over HTTP (Sonnet)
READ: BRIEF-COMMON.md; rulings; `tests/db/email-channel-acceptance.test.ts` (HTTP + `runOnceCore` + fetch spy), `tests/db/announcements-acceptance.test.ts`
FILES: `tests/db/whatsapp-acceptance.test.ts` (new)
MIGRATION: none
TEST: set up a fixture institution (`is_demo=false`), one section, guardians A and B with valid 10-digit phones, key + number stubbed, passthrough spy.
1. Guardian B: `POST /api/v1/actions/notification.preferences.set` `{announcement, whatsapp, false}` → 200.
2. Admin creates and publishes a section announcement over HTTP; run `runOnceCore` once.
   - A has a whatsapp attempt `sent`/`msg91`/`wa_1`. The MSG91 body has name `coolskool_announcement`, `to:["91<A phone>"]`, and `body_1` = title.
   - B has no whatsapp attempt and does have an sms attempt.
   - Admin `GET /api/v1/query/notifications.listDeliveryLog` includes a `whatsapp` row.
   - Rerun the runner → no extra MSG91 call.
3. Admin `POST /api/v1/actions/core.module.set {key:"whatsapp", enabled:false}` → 200. Then:
   - Guardian A's whatsapp preference set → 403 `forbidden`.
   - Publish a second announcement and run the runner → no whatsapp attempts, no new calls.
4. Module back on, key unstubbed, third announcement → `simulated`, zero calls.
ACCEPT: `pnpm test:db tests/db/whatsapp-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 6: X05-T6 Seed section `notifications` (Sonnet, seed owner)
READ: BRIEF-COMMON.md; rulings (Demo safety); `scripts/seed/index.ts`, `scripts/seed/sections/core.ts` (`guardian.one`/`guardian.two`, phones), `scripts/seed/sections/people.ts` (guardian links, children), `scripts/seed/lib/{ids,context}.ts`; `tests/db/seed-timetable.test.ts` (seed test pattern)
FILES: `scripts/seed/sections/notifications.ts` (new); `scripts/seed/index.ts` (register last); `tests/db/seed-whatsapp.test.ts` (new)
MIGRATION: none
EXPORTS: `run(ctx)`, all deterministic (uuidV5 entity ids):
- Upsert guardian.two's preference `{announcement, whatsapp, enabled:false}`.
- `createNotification(ctx.admin, …)` (import `../../../src/modules/notifications/service.ts`) for:
  - one `announcement` in `en` to guardian.one and guardian.two: title `Annual Day on 21 November`, excerpt `Parents are invited to the Annual Day function at 10 am in the school hall.`, `contacts.sms` from the guardian row;
  - one `attendance_absence` in `hi` to guardian.one for their first child (vars from seeded rows, date = seed base date).
- The demo tenant is `is_demo`, so WhatsApp stays simulated even with a key set.
TEST FIRST: guardian.one has a `whatsapp` attempt `simulated` for the announcement and one whose `rendered_body` contains `स्कूल अपडेट`; guardian.two has the opt-out row and no whatsapp attempt for the announcement (sms attempt present); running the section twice adds no rows.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset` (twice); `pnpm test:db tests/db/seed-whatsapp.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 7: X05-T7 Docs (Haiku)
READ: rulings + skipped list; T1–T6 reports (`06-backend-packets/X05-T<k>-report.md`); T2 inline snapshots in `tests/unit/whatsapp-channel.test.ts`
FILES (docs only):
- `docs/planning/coolskool/03-feature-matrix.md`: edit the existing F-COM-04 row. Feature `WhatsApp channel (MSG91 approved templates, en/hi; live when MSG91_AUTH_KEY + MSG91_WA_NUMBER set)`, Demo `sim`, Accept `tests/db/whatsapp-acceptance.test.ts`.
- `10-backlog-index.md` §3: `0089` claimed → built.
- `07-security-and-ai-governance.md`:
  - §1 threat row "PII egress to WhatsApp BSP": names and phones are sent only when configured, never for `is_demo`, no PII in `error`, key never logged; test `tests/unit/whatsapp-channel.test.ts`.
  - §4 one line: "X05: no new definer; `app.module_catalog` insert for `whatsapp`".
- `06-workflows-and-contracts.md` §3: channel cells gain "whatsapp (MSG91 when configured, else sim)".
- `11-operations.md` runbook:
  - MSG91 WhatsApp setup: WABA + integrated number + display-name approval.
  - Submit 10 templates `coolskool_<type>`, `en`/`hi`, category Utility, body text = the snapshots.
  - Set the 3 env names on Vercel only after approval.
  - Collect WhatsApp opt-in on the admission form (Meta policy, DPDP Act 2023).
  - Manual check on a non-demo school.
- `12-decision-log.md` §Debt, next free DBT numbers, one row each:
  - one deployment-wide sender (no per-school WABA);
  - no delivery/read receipts and no STOP keyword (needs an inbound webhook + append-only events table);
  - no consent record (opt-out only);
  - recipient `lang` always `en` (no guardian language column; shared with SMS);
  - failed attempts never retried, and a crash between send and insert can double-send;
  - per-recipient sequential calls (batch via the bulk `to` array);
  - plus any debt the reports name.
- `05-data-architecture.md` §8.1: one line for seed section `notifications` (T6 entities).
ACCEPT: `pnpm lint` (no code touched)

---

Controller after T7:
1. Security review (Sonnet) on the T2 + T3 diff: egress, PII in `error`/audit, key never logged, the `is_demo` guard, msisdn validation.
2. Full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm test:security`. `pnpm db:reset` and `pnpm seed` must run clean.
3. Commit and push.
4. The owner runs the hosted push of `0089` (`pnpm exec supabase db push --linked --include-all`). The owner sets the MSG91 env vars on Vercel only after Meta approves the templates.
5. Post `DONE X05 <sha>`.
