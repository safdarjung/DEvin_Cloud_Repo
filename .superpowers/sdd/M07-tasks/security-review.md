# M07 timetable — security review

Scope: supabase/migrations/20261028000069_timetable.sql; src/modules/timetable/{actions.ts,queries.ts,query-defs.ts,schemas.ts}; src/lib/auth/permissions.ts (timetable.manage/timetable.read); src/app/api/v1/{actions/all-actions.ts,query/all-queries.ts}; scripts/seed/sections/timetable.ts (seed-only, service role, out of prod attack surface).

## Findings

supabase/migrations/20261028000069_timetable.sql:181-190: LOW: `timetable_versions_update` policy only blocks direct `status` changes (via `guard_timetable_versions_update`); it does not stop owner/principal/admin from editing `academic_year_id` on an already-`published` version outside `publish_timetable`'s governance (no archive-previous-version step, no `app.audit` call for that path). The partial unique index still prevents two simultaneous published versions for the same year, so this is a governance/audit-trail gap, not a privilege escalation. Fix: either drop `academic_year_id` from the ordinary update's allowed columns (add it to the guard trigger's blocked-column list) or accept and document the gap.

supabase/migrations/20261028000069_timetable.sql: guard_timetable_slots_write / guard_timetable_slots_period (per-row SECURITY DEFINER, lines 229-284): on a 500-row saveDraft insert (schema max) each row triggers its own SELECT against timetable_versions/periods by PK. Not a security bug (correctly scoped, PK-indexed), but matches the named RLS-perf risk — flagging as the one place with per-row definer calls under this diff; no app-level N+1 beyond what 0068 already established as the accepted pattern.

## Checked, no issue found

- Tenant/FK binding on `timetable_slots` insert/update policies (lines 309-368): class_section_id, subject_id, teacher_id (via `app.staff_in_institution`), room_id, period_id, version_id all existence-checked against the row's own `institution_id` — blocks cross-tenant FK references.
- `timetable_slots_select` policy (293-307): owner/principal/admin see all statuses; other staff roles and guardian/student restricted to `status='published'`; guardian/student additionally gated by `class_section_id = any((select app.my_student_section_ids()))` — initPlan-cached helper, no per-row definer call (lesson 7 compliant). Section ids are globally unique so no cross-tenant leak via that helper.
- `publish_timetable` (app.* core, 379-438): `current_user_id()` null check, row-locked `for update`, `has_role(v_version.institution_id, [...])` checked against the *version's own* institution (not caller-supplied), draft-only guard, archive-before-publish ordering matches the partial-unique-index constraint, audits with ids only. `public.*` wrapper revoked from anon, granted only to authenticated.
- Guard triggers (`guard_timetable_versions_update`, `guard_timetable_slots_write`): bypass only via `request.jwt.claims->>'role'='service_role'` or `session_user='postgres'` — no null-uid bypass (lesson 5).
- `src/modules/timetable/actions.ts` `createVersion` copy-from-version path (166-233): `assertVersionInInstitution` scopes `copyFromVersionId` to `ctx.institution.id` before copying slots — cannot copy another institution's draft.
- `saveDraft` (235-302): delete-then-insert both filtered by `version_id` + `institution_id`; `replaceSectionIds` cannot touch another version's or another institution's slots. Version must be `draft` (checked in app code, enforced again by DB guard trigger — defense in depth). Multi-row insert conflict mapping (23505 teacher/section/room, 42501 cross-tenant FK) produces `conflict`/`validation_failed` without leaking raw SQL text (`throwMapped`/`mapSqlError` → generic message + correlation id on unmapped errors).
- `publishVersion` action is a thin RPC wrapper; relies on `publish_timetable`'s own checks — no bypass surface added at the action layer.
- `timetable.manage` vs `timetable.read` permission matrix (`src/lib/auth/permissions.ts` 95-290) matches ruling exactly: owner/principal/admin get `.manage`; all 9 roles get `.read`.
- `query-defs.ts`: `forSection`/`forTeacher`/`forStudent`/`todayFor` gated on `timetable.read` (RLS narrows further); `conflicts`/`teacherWorkload`/`roomUtilisation` gated on `timetable.manage` — not reachable by non-managers at the action-registry layer even before RLS.
- `timetableForTeacher`'s caller-supplied `staffId` (queries.ts:143-153): any staff role can pass an arbitrary `staffId`; RLS still only returns that teacher's slots when the version is `published` (or caller is owner/principal/admin), matching the ruling that "other staff roles" see published slots institution-wide — not a new leak, just RLS doing the real narrowing as documented.
- `timetableForStudent` (156-168): resolves the enrolment row scoped to `ctx.institution.id` + `studentId`; a guardian outside that student's family gets no enrolment row (RLS on `enrolments`) → empty array, not an error — no leak via timing/error-shape difference.
- `audit()` calls in actions.ts pass only ids/counts (no PII, no slot payload) — consistent with rule 6/lesson 10.
- No hardcoded secrets, no raw string-built SQL, no dynamic SQL in any reviewed file. All definer functions `set search_path=''` with qualified names.
- Manifest/registry wiring: `timetable/actions.ts` imported in `all-actions.ts`, `timetable/query-defs.ts` imported in `all-queries.ts`; C-03 escalation fixtures present for all four `timetable.manage` actions (`tests/security/escalation.test.ts:175-188`).
- `scripts/seed/sections/timetable.ts`: uses `ctx.admin` (service-role) only, as required for seed scripts; direct `status='published'` update bypasses the guard trigger intentionally and correctly (service-role claim), out of the authenticated-user attack surface.

## Severity counts

CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 2
