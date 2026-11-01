### Task 11: M03-T11 Onboarding journey over HTTP (acceptance)
READ: BRIEF-COMMON.md; the M01/M02/M03 route tests
FILES: `tests/db/onboarding-journey.test.ts` (new)
TEST: from zero, only HTTP handlers + bearer tokens: new user → `POST /api/v1/institutions` → owner creates department, teaching staff, grade, section, subject, subject assignment via `/api/v1/actions/*` → `core.member.invite` teacher (staffId) → teacher auth user signs in → `POST /api/v1/invitations/accept` → teacher `GET /api/v1/query/academics.listTeachableSections` returns the new section → owner `core.member.setStatus` disabled → teacher call → 404. Escalations: teacher `core.member.invite` → 403; admin invite owner → 403.
ACCEPT: `pnpm test:db tests/db/onboarding-journey.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T11: security-reviewer pass on the M03 diff (auth + RLS + definers); `07 §4` definer rows; `10-backlog-index.md` §3 marks 0064/0065/0079 built; DBT-12 → resolved by invite with `guardianId`; full gate; commit/push; `DONE M03 <sha>`. Follow-ups (not M03): `core.listMembers` / `core.listInvitations` queries; channel delivery of invites (M17).
