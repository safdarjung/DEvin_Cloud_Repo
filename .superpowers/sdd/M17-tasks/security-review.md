# M17 Resend email adapter (D42) — security review

Scope: src/modules/notifications/channels/{resend.ts,types.ts}; src/modules/notifications/service.ts; src/modules/core/actions.ts (`inviteMember`/`buildInviteEmailText` only); src/modules/notifications/components/MessageLog.tsx; src/modules/core/components/dashboard/RecentActivity.tsx; src/app/(tenant)/[institution]/dashboard/page.tsx (activity badge lines); src/modules/notifications/queries.ts (doc comment only); .env.example; vitest.config.mts. No migration, no new permission/ErrorCode/RLS/definer surface (per M17-tasks.md rulings) — confirmed, not reviewed as new attack surface.

## Findings

None at CRITICAL/HIGH/MEDIUM.

src/modules/notifications/channels/resend.ts:59-65: LOW: `resultFromResponse` does `await res.json()` unguarded inside the caller's `try`; a 2xx response with a non-JSON or malformed body throws, which the outer `catch` maps to `error:"resend_network"` — functionally safe (never throws past the adapter, never leaks the body) but mislabels a parse failure as a network failure. Not exploitable (Resend always returns JSON on 2xx); cosmetic only.

## Checked, no issue found

- **Key handling**: `resendConfigured()` reads `process.env.RESEND_API_KEY` per call (never cached at module load), matching the "One predicate" ruling; nothing else in the diff reads the key. Never logged, never placed in any `error`/`audit`/`result` field — grepped the whole diff for `console.*`, found none.
- **PII in errors (lesson 10)**: `resultFromResponse` only ever returns `resend_http_<status>` (no response body text); the network-error branch returns the fixed string `resend_network`, discarding the caught error object entirely — neither path can leak the recipient address or provider response text. Verified by `tests/unit/resend-channel.test.ts` ("no address leaked on non-2xx").
- **PII in audit**: `inviteMember`'s audit row (`core/actions.ts:137-142`) carries only `{ role, delivery }`, never the invitee email; `tests/db/member-invite-actions.test.ts` asserts `JSON.stringify(auditRow.after)` does not contain the email. `delivery_attempts.to_address` is written (by design, pre-existing column) but is never selected by `notifications/queries.ts#listDeliveryLog` (C-31) and is gated behind `notification.log.read` (owner/principal/admin/admissions) via existing RLS + `requirePermission` — no new exposure.
- **Reserved-domain guard**: `isReservedTestAddress` lower-cases the domain before matching; TLD check is a true suffix match (`.test`/`.example`/`.invalid`/`.localhost`) and the domain list is an exact-string match (`example.com/net/org`), so no subdomain or case-based bypass (e.g. `evil.com` cannot spoof `example.com`; a domain that happens to end in a reserved TLD is simulated, never the reverse — fails safe). Covered by `tests/unit/resend-channel.test.ts`.
- **No SSRF / no header injection**: the fetch target is the fixed `RESEND_URL` constant — `toAddress` only ever goes into the JSON body (`to: [toAddress]`), never into the request URL or a header; `Idempotency-Key` is always a server-built string (`<notificationId>:<channel>` or `invite:<invitationId>`), never user input. `RESEND_FROM`/`RESEND_API_KEY` are deploy-time env vars, not request-scoped.
- **No real mail from tests**: `vitest.config.mts` deletes `RESEND_API_KEY` after `.env.local` load; every test that needs it re-adds it via `vi.stubEnv` plus a passthrough fetch spy scoped to `https://api.resend.com/`. Confirmed by re-running the full set below with zero unexpected network calls.
- **Idempotency / no double-send**: `ensureDeliveryAttempts` only sends for channels with no existing `delivery_attempts` row; the Resend `Idempotency-Key` is a second layer in case a retry races a crash between send and insert. `tests/db/notifications-email-channel.test.ts` ("rerun of the same notification does not call Resend again") and `tests/db/email-channel-acceptance.test.ts` (job rerun makes no extra call) both prove this at the DB/HTTP layer, not just unit-mocked.
- **Opt-out respected**: `disabledChannels` (service.ts:33-46) is read and applied (`template.channels.filter`) before any channel — including email — is attempted; `in_app` is explicitly exempt per the 0068 ruling, matching the pre-existing contract. Verified by the opt-out test in `tests/db/notifications-email-channel.test.ts`.
- **Invite flow gating**: email is attempted only when `resendConfigured() && appUrl` (both false by default) and only inside the existing `member.manage`-gated `inviteMember` action; a send failure (`catch`-free — the adapter itself never throws) never fails the action or blocks the invitation row from being created (`tests/db/member-invite-actions.test.ts` "Resend 500" case).
- **Honesty badges (rule 7)**: `MessageLog` shows `<SimulatedBadge />` only when `row.status === "simulated"`, otherwise the real status badge; dashboard/`RecentActivity` section badges use the same `some(e => e.status === "simulated")` condition consistently in both places. `tests/unit/delivery-badge.test.ts` covers the mixed-row case.
- **No new dependency, no raw/dynamic SQL, no new DB surface**: adapter is `fetch`-only; no migration, no definer, no RLS, no new `ErrorCode`, no `all-actions.ts`/`all-queries.ts`/C-03 change — matches the rulings' explicit "no new X" list, confirmed by `git status` showing no changes to those files for this diff.

## Severity counts

CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 1

## Fix round

No CRITICAL/HIGH/MEDIUM findings to fix. The one LOW (resend.ts:59-65 JSON-parse-as-network-error mislabel) is cosmetic, not a security defect, and is **skipped** — fixing it would mean distinguishing a parse failure from a transport failure inside the existing `try/catch`, which is a behavioral change outside this review's fix scope (CRITICAL/HIGH/MEDIUM only) and not requested by the task.

Milestone test files rerun (DB up via `pnpm db:start`), all green, no code changed as a result of this review:

- `pnpm test tests/unit/resend-channel.test.ts tests/unit/notification-templates.test.ts tests/unit/delivery-badge.test.ts` → 3 files, 22 tests passed
- `pnpm test:db tests/db/notifications-email-channel.test.ts tests/db/notifications.test.ts tests/db/notify-announcement.test.ts tests/db/member-invite-actions.test.ts tests/db/onboarding-journey.test.ts tests/db/email-channel-acceptance.test.ts` → 6 files, 31 tests passed
- `pnpm test:security tests/security/escalation.test.ts` → 842 tests passed
- `pnpm lint` → clean (whole project)
- `pnpm typecheck` → clean (whole project)
