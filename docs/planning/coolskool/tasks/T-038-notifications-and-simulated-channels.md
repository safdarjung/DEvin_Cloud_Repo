# T-038 — Notifications inbox, adapters, simulated SMS/email, message log

| Field | Value |
|---|---|
| Lane / Day | D / Day 8 |
| Size | 1 agent-day |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-COM-01, F-COM-02, F-COM-05 |
| Depends on | T-037 (merged) |
| Migration | — |

## Business outcome
Guardians and staff get real in-app notifications; SMS and email are visibly simulated in a message log so the demo is honest about what is real.

## Current repo state (verify before starting)
- Tables: `grep -n "create table public.notifications\|delivery_attempts" supabase/migrations/20261028000003_platform.sql`.
- Placeholder handlers: `grep -n "not_implemented" src/modules/jobs/handlers/index.ts`.
- Templates/languages in settings: `grep -n '"communication"' src/modules/core/schemas.ts`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §3` (types, recipients, channels, templates), `§W5` (notification side effects) · `04-architecture.md §7` · `05-data-architecture.md §2.1` (`notifications`, `delivery_attempts`) · `07 §2` (`notification.read`, `notification.log.read`), `§3` (delivery logs are confidential) · `08 §3 C-30, C-31`.

## Files to inspect first
`src/modules/jobs/types.ts`, `registry.ts`, `handlers/index.ts` · `src/modules/people/queries.ts` (primary guardian lookup) · `src/app/(tenant)/[institution]/layout.tsx` (header slot for the bell).

## Expected changes
- `src/modules/notifications/channels/types.ts` — `Channel { name; send(attempt): Promise<DeliveryResult> }`.
- `src/modules/notifications/channels/{inApp,simulatedSms,simulatedEmail}.ts` — in-app marks `sent`; simulated ones render the template and store `status = 'simulated'`, `to_address`, `rendered_body`.
- `src/modules/notifications/templates.ts` — EN/HI templates for the five types from `06 §3`, variables validated.
- `src/modules/notifications/service.ts` — `createNotification({ institutionId, recipientUserId, type, vars, channels })` with unique key `data.key = <type>:<entity_id>:<recipient>` (idempotent) and `delivery_attempts` rows per channel.
- `src/modules/jobs/handlers/notify.*.ts` — the five handlers resolving recipients (primary guardian user, admissions role members, requester) and calling `service.ts`.
- `src/modules/notifications/{queries,actions}.ts` — `listMyNotifications`, `unreadCount`, `markRead` (`notification.read`), `listDeliveryLog` (`notification.log.read`).
- `src/components/SimulatedBadge.tsx` — shared honesty badge.
- Pages: `src/app/(tenant)/[institution]/notifications/{page,log/page}.tsx`; `src/modules/notifications/components/{Bell,Inbox,MessageLog}.tsx`.
- `tests/db/notifications.test.ts`, `tests/unit/notification-templates.test.ts`.

## Must not modify
Migrations · `src/modules/jobs/runner.ts` · lane modules that enqueue jobs (they already use the job types).

## Permissions / nav / migration numbers needed from the lead
Nav: `{ href: '/notifications', label: 'Notifications', permission: 'notification.read' }` and header slot for `<Bell />`; `/notifications/log` under it.

## Security and data-integrity requirements
- Recipient scoping by RLS class O; `listDeliveryLog` restricted by `notification.log.read` and institution (phone numbers are confidential).
- Simulated adapters must never call the network; a unit test asserts no `fetch`.
- Handler idempotency: rerunning a job creates no duplicate notification (unique key).
- Every simulated row renders with `<SimulatedBadge />` wherever shown.

## Acceptance criteria
1. Submitting attendance with two absences (T-015) and running jobs creates two notifications for the right guardians and two `simulated` SMS rows with rendered bodies in the chosen language.
2. Bell shows unread count; opening marks read; another user cannot read it (C-30).
3. Message log lists SMS/email with a Simulated badge and no provider refs (C-31).
4. Re-running the same job leaves counts unchanged.

## Tests (write failing tests first) and exact commands
- `tests/db/notifications.test.ts` (C-30, C-31, idempotent handler) → `pnpm test:db -- tests/db/notifications.test.ts`
- `tests/unit/notification-templates.test.ts` (variables, HI/EN, SMS length) → `pnpm test -- tests/unit/notification-templates.test.ts`

## Deliverables
Channel interface + three adapters, templates, service, five handlers, queries/actions, badge, two pages, tests.

## Assumptions and risks
- Language per guardian is P2; demo uses `settings.communication.languages[0]` with HI shown as a toggle in the log.
- `enrolment_welcome` email simulated; if the fallback ladder drops email, keep the adapter but hide the log filter.

## Completion report
Use the format in `CLAUDE.md`.
