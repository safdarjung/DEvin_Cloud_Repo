Packet: M06-T5 Announcement + preference actions

Files changed:
- src/modules/notifications/announcements.schemas.ts (new)
- src/modules/notifications/announcements.actions.ts (new, "use server")
- tests/db/announcement-actions.test.ts (new)
- src/app/api/v1/actions/all-actions.ts (+1 import line)
- tests/security/escalation.test.ts (+3 C-03 fixtures)

Behavior implemented:
- announcement.create: insert draft announcement + audience rows (discriminated union: school/role/grade/section), permission announcement.manage, audit `announcement.created` (ids/count only). Draft stays if audience insert fails (brief-sanctioned).
- announcement.publish: thin wrapper over `publish_announcement` RPC (permission announcement.manage). No extra audit() call — the RPC already writes `app.audit` internally, same shape as exam.result.publish/website.page.publish.
- notification.preferences.set: upsert own row by composite PK (user_id, institution_id, category, channel), permission notification.read, audit `notification.preference_set`.

Tests run:
- `pnpm test:db tests/db/announcement-actions.test.ts` → 4/4 pass (create+publish+job-queued, teacher forbidden, cross-institution grade rejected, preference round-trip).
- `pnpm test tests/unit/action-names-unique.test.ts` → 4/4 pass.
- `pnpm test:security tests/security/escalation.test.ts` → 642/642 pass.
- `pnpm lint` → clean. `pnpm typecheck` → clean.

Tests not run and why: full `pnpm test:db` / `pnpm test:security` suites not run (packet rule: own file only; other agent editing notifications/service.ts, templates.ts, jobs/** in parallel).

Limitations / honesty label: n/a (backend action only, no UI).

Security / integration risks: audience grade/section institution-scoping is enforced entirely by migration 0068's RLS `with check` (exists-subquery); the action does no extra app-level check before the insert — relies on T2's RLS, verified by the cross-institution test (gets a generic `internal`/mapped error, not a PostgREST RLS-specific code, since the row-level violation doesn't match the `code:*` convention — still `ok:false`, test only asserts that).

Follow-ups: none.

New dependencies (justification): none.

Assumptions made: `announcement.publish`'s TS action does not duplicate the SQL-side audit row (mirrors existing publish_exam_results/publish_page action pattern — audit lives in the RPC, not the action layer).
