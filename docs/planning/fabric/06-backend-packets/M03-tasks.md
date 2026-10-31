# M03 — Onboarding + school setup

Source: `07-master-plan-v1-v2.md` §3 M3. Migrations `0064` (claimed), `0065` (claimed), `0079` (spare, claimed here for the invitation RPCs — 0064 alone would exceed the 150-line task cap). No new deps. Spec: `docs/planning/coolskool/05-data-architecture.md` §3, `07-security-and-ai-governance.md` §2.2 + §4 (definer table — every new definer gets a row), DBT-12.

Facts every task relies on:
- Staff-class memberships require `staff_id`, guardian → `guardian_id`, student → `student_id`, linked row in the same institution (`app.validate_membership_link`, 0002/0029).
- `app.guard_membership_write` (0033/0038) blocks self-inserts, so a definer that creates the caller's own membership needs a bypass: GUC `app.allow_membership_bootstrap`, set with `set_config(…, 'on', true)` only inside `create_institution`/`accept_invitation` (lesson 11 pattern, `coalesce(current_setting(…, true), '') = 'on'`).
- Setup-table write policies (0002/0004/0005) are owner/principal/admin = exactly the holders of `academics.manage`/`staff.write`/`member.manage`/`institution.settings.manage`, but plain FKs are not bound to the same institution (lesson 2) → 0065.
- Onboarding calls that run before the caller has a membership (`create institution`, `accept invitation`) cannot go through the tenant dispatcher (it resolves membership from the slug). Ruling: two small non-tenant routes, `POST /api/v1/institutions` and `POST /api/v1/invitations/accept`, same envelope/bearer/Origin handling via `src/lib/http/dispatch.ts` helpers.
- Apply a new migration locally with `pnpm exec supabase migration up --local`, then `pnpm db:types` (raw output, additions only). Never `db:reset`.

Order: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 (sequential; the migration tasks are DB owners).

---

### Task 1: M03-T1 Migration 0064 — invitations table, bootstrap guard, create_institution
READ: BRIEF-COMMON.md; `supabase/migrations/20261028000002_core.sql` (institutions, years, terms, memberships), `…0033_membership_role_guard.sql`, `…0038*`; `src/modules/core/schemas.ts` (settings defaults); `07 §4`
FILES: `supabase/migrations/20261028000064_onboarding.sql` (new); `tests/db/onboarding-rpc.test.ts` (new); `src/lib/db/types.ts` (regen)
EXPORTS:
- `public.invitations` (id, institution_id → institutions, email text not null (stored lower-case, check `email = lower(email)`), role (same check list as memberships), staff_id/guardian_id/student_id (FKs, nullable), token_hash text not null unique, invited_by → profiles, expires_at timestamptz not null, accepted_at, accepted_by → profiles, revoked_at, created_at, updated_at + `app.set_updated_at` trigger). RLS on; SELECT for `app.has_role(institution_id, array['owner','principal','admin'])`; no INSERT/UPDATE/DELETE policies (RPC-only); column-level: revoke table SELECT from `authenticated`, grant SELECT on every column except `token_hash`.
- `create or replace function app.guard_membership_write()` = 0038 body + early `return new` when the bootstrap GUC is `on`.
- `public.create_institution(p_name text, p_slug text, p_timezone text default 'Asia/Kolkata', p_year_start date default null) returns uuid` — security definer, `search_path=''`. Rules: caller `app.current_user_id()` not null else `code:unauthenticated`; name trimmed 2–120; slug `^[a-z0-9](-?[a-z0-9])*$`, 3–40 chars, not in reserved `{api,s,login,logout,auth,admin,app,www,static,public,demo,invite,onboarding}` → `code:validation_failed`; caller already owner (active) of ≥ 3 institutions → `code:quota_exceeded` (shortcut comment: per-user cap, replace with billing later); duplicate slug (23505) → `code:conflict`. Inserts: institution (settings `{"locale":{"timezone":p_timezone,"currency":"INR"}}` unless core/schemas.ts needs the full default object), staff row for caller (employee_no `OWN-001`, full_name from profiles, designation `Owner`, email from `auth.users`, user_id caller), owner membership (status active, staff_id) under the GUC, current academic year (start = p_year_start or 1 April on/before today; name `YYYY-YY`; ends day before next start) and two terms (`Term 1` start–30 Sep, `Term 2` 1 Oct–end), one `app.audit` row (`core.institution.created`, no PII). `execute` revoked from public/anon, granted to authenticated.
TEST FIRST (`tests/db/onboarding-rpc.test.ts`, real signed-in clients; create a fresh auth user with no membership via the admin client and clean up): "new user creates an institution and becomes its active owner"; "default year + two terms exist and the year is current"; "reserved slug → validation_failed"; "duplicate slug → conflict"; "fourth owned institution → quota_exceeded"; "a member still cannot insert their own membership directly (guard intact)"; "invitations.token_hash is not selectable by an admin".
ACCEPT: `pnpm test:db tests/db/onboarding-rpc.test.ts`; `pnpm test:security` (grants test must list the new function — update `scripts/audit-grants.sql` expectations only if that suite requires it, and say so); `pnpm lint`; `pnpm typecheck`

### Task 2: M03-T2 Migration 0079 — invite / accept / revoke RPCs
READ: BRIEF-COMMON.md; Task 1 migration; `…0033*` (role rules to mirror); `…0029*` (link validation)
FILES: `supabase/migrations/20261028000079_invitation_rpcs.sql` (new); `tests/db/invitation-rpc.test.ts` (new); `src/lib/db/types.ts` (regen)
EXPORTS (all security definer, `search_path=''`, authenticated only, audited without email):
- `public.invite_member(p_institution_id uuid, p_email text, p_role text, p_staff_id uuid default null, p_guardian_id uuid default null, p_student_id uuid default null) returns table (invitation_id uuid, token text)` — caller `app.has_role(p_institution_id, owner/principal/admin)` else forbidden; role `owner` needs owner caller, `principal` needs owner/principal (mirror 0033); exactly the link the role needs, linked row in `p_institution_id` (else validation_failed); link not already on an active membership with that role (conflict); email lower-cased, basic format check; an open (not accepted/revoked/expired) invitation for (institution, email, role) → conflict; token = 32 random bytes hex (`extensions.gen_random_bytes`), store sha256 hex (`extensions.digest`); expires now()+7 days; return the token once.
- `public.accept_invitation(p_token text) returns uuid` (membership id) — caller not null; invitation by hash; accepted/revoked/expired → invalid_state; unknown → not_found; caller's `auth.users.email` (lower) must equal invitation email → forbidden; existing (institution, user, role) membership → conflict; insert active membership with the link under the bootstrap GUC; set `user_id` on the linked staff/guardians/students row when null; stamp accepted_at/accepted_by.
- `public.revoke_invitation(p_invitation_id uuid) returns void` — caller owner/principal/admin of the invitation's institution (same owner/principal rules by invited role); only open invitations (else invalid_state).
TEST FIRST: "admin invites a teacher linked to a staff row; the teacher accepts and gets an active teacher membership"; "admin cannot invite an owner"; "teacher cannot invite"; "staff_id from another institution → validation_failed"; "wrong email cannot accept"; "token is single-use"; "revoked invitation cannot be accepted"; "guardian invite links guardians.user_id (DBT-12)".
ACCEPT: `pnpm test:db tests/db/invitation-rpc.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`

### Task 3: M03-T3 Migration 0065 — bind setup-table FKs to the institution
READ: BRIEF-COMMON.md lesson 2; `…0036*` (the enrolments/subject_assignments precedent — mirror its style); write policies in 0002/0004/0005
FILES: `supabase/migrations/20261028000065_setup_fk_binding.sql` (new); `tests/db/setup-fk-binding.test.ts` (new)
EXPORTS: drop + recreate INSERT/UPDATE policies (same role list) with `with check` also proving every FK belongs to the row's institution: `terms.academic_year_id`; `class_sections.grade_id`, `.academic_year_id`, `.class_teacher_id` (when not null); `staff.department_id` (when not null); `curriculum_units.subject_id` (+ any other FK on it). Table-qualified columns in subqueries.
TEST FIRST: "admin of A cannot create a section in A pointing at B's grade"; same for term→B's year, staff→B's department, class_teacher→B's staff; "valid same-institution insert still works".
ACCEPT: `pnpm test:db tests/db/setup-fk-binding.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`

### Task 4: M03-T4 POST /api/v1/institutions
READ: BRIEF-COMMON.md; `src/lib/http/dispatch.ts`; `src/app/api/v1/actions/[name]/route.ts`; `tests/db/api-actions-route.test.ts`
FILES: `src/app/api/v1/institutions/route.ts` (new); `src/modules/core/schemas.ts` (edit: `CreateInstitutionSchema` {name, slug, timezone?, yearStart? (iso date)}); `tests/db/api-institutions-route.test.ts` (new)
EXPORTS: `POST` — `readPostBody` (Origin + cap) → Zod (`validation_failed` 422 with fieldErrors) → claims via `getClaims()` inside `withBearerToken` when a bearer is present (401 if none) → `supabase.rpc("create_institution", …)` with the caller's client → `mapSqlError` on error → `apiResponse(ok({ institutionId, slug }))`. Body `{ input: {...} }` (no `institution` field).
TEST FIRST: brand-new user with bearer → 200 and then `POST /api/v1/actions/core.feature.set` (or any owner-only action) with that slug succeeds; no token → 401; reserved slug → 422; duplicate → 409; cross-site Origin → 403.
ACCEPT: `pnpm test:db tests/db/api-institutions-route.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: M03-T5 core.member.invite / core.member.revokeInvite actions
READ: BRIEF-COMMON.md; `src/modules/core/actions.ts` (mirror `core.feature.set`); `tests/db/core-actions.test.ts` (callAs pattern)
FILES: `src/modules/core/actions.ts` (edit); `src/modules/core/schemas.ts` (edit); `tests/db/member-invite-actions.test.ts` (new)
EXPORTS: `inviteMember` = `defineAction({ name: "core.member.invite", permission: "member.manage", schema: { email, role, staffId?, guardianId?, studentId? } })` → `invite_member` RPC with `ctx.institution.id` → returns `{ invitationId, token, delivery: "simulated" }` (no channel yet — D42/M17; UI shows the link with `<SimulatedBadge />`). `revokeInvite` = `core.member.revokeInvite` {invitationId} → `revoke_invitation`. Errors via `mapSqlError`.
TEST FIRST: admin invites teacher → ok with 64-hex token; teacher → forbidden (permission layer); admin invites owner → forbidden (SQL layer); revoke → ok, second revoke → invalid_state.
ACCEPT: `pnpm test:db tests/db/member-invite-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 6: M03-T6 POST /api/v1/invitations/accept
READ: BRIEF-COMMON.md; Task 4 route (mirror exactly)
FILES: `src/app/api/v1/invitations/accept/route.ts` (new); `src/modules/core/schemas.ts` (edit: `AcceptInvitationSchema` {token: 64 hex}); `tests/db/api-invitation-accept-route.test.ts` (new)
EXPORTS: `POST` same shape as Task 4 → `accept_invitation` → `apiResponse(ok({ membershipId, institutionSlug }))` (slug looked up after accept with the caller's client).
TEST FIRST: invited user (auth user created with the invited email) accepts with bearer → 200, then a teacher-permitted query via `/api/v1/query/...` with that slug → 200; reused token → 409/invalid_state mapping; no token → 401; malformed token → 422.
ACCEPT: `pnpm test:db tests/db/api-invitation-accept-route.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 7: M03-T7 core.member.setRole / core.member.setStatus
READ: BRIEF-COMMON.md; `…0033*`, `…0038*` (guard rules); `src/modules/core/actions.ts`
FILES: `src/modules/core/actions.ts` (edit); `src/modules/core/schemas.ts` (edit); `tests/db/member-manage-actions.test.ts` (new)
EXPORTS: `core.member.setRole` {membershipId, role ∈ staff-class roles} — only between staff-class roles (link unchanged); `core.member.setStatus` {membershipId, status: active|disabled}. Both `member.manage`, update `memberships` with the caller's client (RLS + guard decide), `.select().single()` so a hidden row → not_found, audit `core.member.role_set` / `core.member.status_set`.
TEST FIRST: principal moves a teacher to exam_controller → ok; admin sets someone to owner → forbidden; admin edits own membership → forbidden; teacher → forbidden; disabled member's `getTenantContext` → not_found (portal access lost).
ACCEPT: `pnpm test:db tests/db/member-manage-actions.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 8: M03-T8 Academic year, term, institution settings actions
READ: BRIEF-COMMON.md; `src/modules/core/{actions,schemas}.ts`; `tests/unit/institution-settings.test.ts`
FILES: `src/modules/core/actions.ts` (edit); `src/modules/core/schemas.ts` (edit); `tests/db/core-setup-actions.test.ts` (new)
EXPORTS: `core.academicYear.upsert` {id?, name, startsOn, endsOn, isCurrent?} (`academics.manage`; making one current clears the previous current in the same handler — the partial unique index forbids two); `core.term.upsert` {id?, academicYearId, name, startsOn, endsOn} (`academics.manage`); `core.institution.updateSettings` {name?, timezone?, settings patch validated by the existing settings schema} (`institution.settings.manage`). Upsert = update when `id` given (hidden row → not_found) else insert. Audit each. No deletes (YAGNI; FK history).
TEST FIRST: admin creates next year + term → ok; term outside its year → validation_failed (trigger `app.validate_term_dates`); switching current year leaves exactly one current; accountant → forbidden; settings update round-trips timezone.
ACCEPT: `pnpm test:db tests/db/core-setup-actions.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 9: M03-T9 Grades, sections, subjects, subject assignments actions
READ: BRIEF-COMMON.md; `src/modules/academics/assignments.actions.ts` (style); 0005 columns
FILES: `src/modules/academics/setup.actions.ts` (new, `"use server"`); `src/modules/academics/setup.schemas.ts` (new); `tests/db/academics-setup-actions.test.ts` (new); + one import line in `src/app/api/v1/actions/all-actions.ts`
EXPORTS (all `academics.manage`, upsert semantics as Task 8, audited): `academics.grade.upsert` {id?, name, level}; `academics.section.upsert` {id?, gradeId, academicYearId, name, capacity?, classTeacherId?}; `academics.subject.upsert` {id?, name, code?}; `academics.subjectAssignment.set` {classSectionId, subjectId, teacherId} (insert or reactivate; duplicate → conflict). Columns exactly as 0005 (read it; do not invent).
TEST FIRST: admin creates grade → section → subject → assignment; teacher → forbidden; section with another institution's grade → forbidden/validation (0065); duplicate subject assignment → conflict.
ACCEPT: `pnpm test:db tests/db/academics-setup-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 10: M03-T10 Staff + department actions
READ: BRIEF-COMMON.md; 0004 columns; Task 9 files (mirror)
FILES: `src/modules/people/actions.ts` (new, `"use server"`); `src/modules/people/schemas.ts` (new); `tests/db/people-staff-actions.test.ts` (new); + one import line in `all-actions.ts`
EXPORTS (`staff.write`, upsert, audited, no PII in audit): `people.department.upsert` {id?, name}; `people.staff.upsert` {id?, employeeNo, fullName, designation, departmentId?, phone?, email?, isTeaching?, status?: active|inactive}. Duplicate employee_no → conflict.
TEST FIRST: admin creates department + teaching staff → ok; accountant → forbidden; duplicate employee_no → conflict; department from another institution → rejected (0065).
ACCEPT: `pnpm test:db tests/db/people-staff-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 11: M03-T11 Onboarding journey over HTTP (acceptance)
READ: BRIEF-COMMON.md; the M01/M02/M03 route tests
FILES: `tests/db/onboarding-journey.test.ts` (new)
TEST: from zero, only HTTP handlers + bearer tokens: new user → `POST /api/v1/institutions` → owner creates department, teaching staff, grade, section, subject, subject assignment via `/api/v1/actions/*` → `core.member.invite` teacher (staffId) → teacher auth user signs in → `POST /api/v1/invitations/accept` → teacher `GET /api/v1/query/academics.listTeachableSections` returns the new section → owner `core.member.setStatus` disabled → teacher call → 404. Escalations: teacher `core.member.invite` → 403; admin invite owner → 403.
ACCEPT: `pnpm test:db tests/db/onboarding-journey.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T11: security-reviewer pass on the M03 diff (auth + RLS + definers); `07 §4` definer rows; `10-backlog-index.md` §3 marks 0064/0065/0079 built; DBT-12 → resolved by invite with `guardianId`; full gate; commit/push; `DONE M03 <sha>`. Follow-ups (not M03): `core.listMembers` / `core.listInvitations` queries; channel delivery of invites (M17).
