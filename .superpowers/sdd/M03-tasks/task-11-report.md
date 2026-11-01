# Task 11 report — M03-T11 onboarding journey over HTTP

## Files changed
- `tests/db/onboarding-journey.test.ts` (new)

## Behavior implemented
One acceptance test, full M3 journey over real HTTP route handlers (bearer tokens, no direct RPC/SQL shortcuts for anything the API exposes):

1. Brand-new auth user → `POST /api/v1/institutions` → institution + owner membership (via `create_institution`).
2. Owner, via `/api/v1/actions/*`: `people.department.upsert`, `people.staff.upsert` (teaching staff), `academics.grade.upsert`, `core.academicYear.upsert` (own year — `create_institution` already seeds a same-named year, so this uses a random name to avoid the `academic_years_institution_id_name_key` collision), `academics.section.upsert`, `academics.subject.upsert`, `academics.subjectAssignment.set` (binds the teacher to the section).
3. Owner `core.member.invite` (role `teacher`, `staffId`) → new auth user signs in → `POST /api/v1/invitations/accept` → `GET /api/v1/query/academics.listTeachableSections` returns the new section.
4. Escalation: teacher `core.member.invite` → 403 `forbidden` (no `member.manage`).
5. Escalation: owner invites a second staff member as `admin`, admin accepts, admin `core.member.invite` role `owner` → 403 `forbidden` (`invite_member`'s own owner-only-invites-owner check, 0079).
6. Owner `core.member.setStatus` disables the teacher's membership → teacher's `GET academics.listTeachableSections` → 404 (membership `status='active'` filter in `getTenantContext` → `notFound()` → dispatcher maps the digest to 404).

Cleanup: manual, institution-scoped, FK-ordered delete (audit_events → invitations → subject_assignments → class_sections → grades/subjects → memberships → staff → departments → terms/academic_years → institutions) plus `admin.auth.admin.deleteUser` for all 3 created auth users, in a `finally` block.

## Tests run
`pnpm test:db tests/db/onboarding-journey.test.ts` → 1 passed (run twice to confirm cleanup leaves no unique-constraint collisions across runs).
`pnpm lint` → clean.
`pnpm typecheck` → clean.

## Tests not run and why
Full `pnpm test:db` / full suite not run (brief: single-file scope for this task; lead runs the full gate).

## Limitations / honesty label
N/A — test-only change, no UI/AI surface.

## Security / integration risks
None found. No real defect hit — all assertions matched on the first fully-correct attempt (one fixture-data fix needed: avoid colliding with the academic year `create_institution` already seeds).

## Follow-ups
None from this packet.

## New dependencies
None.

## Assumptions made
- "Teaching staff" for `core.member.invite`'s `staffId` = the `people.staff.upsert` row created with `isTeaching: true`, matching `assertTeacherScope`/`taughtSectionIds`' use of `staff.id` as the teacher identity.
- Admin's `core.member.invite(role: "owner")` escalation input omits `staffId`/`guardianId`/`studentId`: `invite_member` (0079) raises the owner-only-invites-owner `code:forbidden` check before it ever reaches the staff-class-role shape validation, so no staff row is needed to hit this path.
- A freshly created academic year for `academics.section.upsert` only needs a name distinct from the one `create_institution` auto-seeds (same institution, same unique index) — no other coupling to the auto-seeded year.
