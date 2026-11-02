# M14 — Student lifecycle

> **LANE B NOTE (controller ruling, overrides any conflicting line below):** this milestone runs in worktree lane B *before* MOD exists. Skip every `module:` field, `requireModule` call and "module disabled → forbidden" test — MOD's retrofit adds them after the merge. Tasks that "wait for MOD" have no MOD dependency here. Exception (M13 holiday block): use the SQL predicate `coalesce((i.settings->'modules'->>'calendar')::boolean, true)` (MOD stores module state at `institutions.settings.modules.<key>`). Other milestones (M08–M10, M17) run concurrently in lane A; their changes are not in this tree.


Source: `07-master-plan-v1-v2.md` §3 M14. Migration `0076` (claimed). No new deps. New owning module `src/modules/lifecycle` (owns `student_lifecycle_events`; plug-and-play module key `student_lifecycle`). `people` (core) gains `people.student.update`, `people.guardian.update`, `people.guardian.link`. Enrolment and student status writes go only through 0076's SQL functions (05 §3 cross-module write path; `enrolments` stays academics-owned). Fixtures replaced: none (`demoApprovals` kind `tc` has no backing state — a TC is issued directly, with no request step; M16 drops that kind). Prereq: milestone MOD (`module?: ModuleKey` on defineAction/defineQuery) merged before T6 and T8 start.

Rulings:
- **Table `student_lifecycle_events`** (append-only log): `id`, `institution_id`, `student_id → students`, `kind` check in `promoted | graduated | transferred_out | withdrawn`, `batch_id uuid?` (one per promote call; null for exits), `from_enrolment_id → enrolments?`, `to_enrolment_id → enrolments?`, `effective_on date`, `reason text?` (≤ 500), `tc_no text?`, `tc_snapshot jsonb?`, `created_by → profiles`, `created_at`/`updated_at` + `set_updated_at`; `app.block_mutation` on update/delete. Checks: `(kind in ('transferred_out','withdrawn')) = (tc_no is not null and tc_snapshot is not null)`; `(kind = 'promoted') = (to_enrolment_id is not null)`. Partial unique `(institution_id, tc_no) where tc_no is not null`; index `(student_id, created_at)`.
- **RLS** (07 §2.2 `student.read`, same shape as 0025 `students_select`, lesson 7 initPlan helpers): SELECT `institution_id = any((select app.my_institution_ids(array['owner','principal','admin','admissions','accountant','exam_controller'])))` or `student_id = any((select app.my_student_ids()))` or `student_id = any((select app.my_taught_student_ids()))`. No INSERT/UPDATE/DELETE policy: rows come only from the 0076 definers. Grants as 0069. `tests/security/rls-expectations.ts` entry mirrors `enrolment_status_history` (`write: []`).
- **State machines + guards.** One GUC `app.allow_lifecycle`, set with `set_config('app.allow_lifecycle','on',true)` only inside the 0076 definers; guards test `coalesce(current_setting('app.allow_lifecycle', true), '') = 'on'` (0042 lesson); bypass only the `service_role` JWT claim or `session_user = 'postgres'` (lesson 5, `nullif` on claims); violations raise `code:invalid_state`. Guards are security invoker BEFORE INSERT OR UPDATE triggers, `execute` revoked from public.
  - `app.guard_enrolment_status` on `enrolments`: `active → completed` (promote/graduate), `active → withdrawn` (both exits), `active → transferred` (reserved for an intra-school section move, 05 §2 "a transfer closes one row and opens another"; not built in M14). Terminal states never change, even under the GUC. A non-trusted INSERT must be `active`. Other columns stay governed by the 0036 policies.
  - `app.guard_student_status` on `students`: `active → alumni` (graduate), `active → withdrawn` (both exits); terminal otherwise; non-trusted INSERT must be `active`.
  - Both exit kinds set the enrolment to `withdrawn`; the event `kind` (`transferred_out` / `withdrawn`) records the difference.
  - `tests/db/academics.test.ts` AC3 updates `enrolments.status` directly as owner; that now fails. T2 rewrites that step to assert `invalid_state`; the history-row assertion (from/to/changed_by) moves to T4 through `exit_student`.
- **`public.promote_students(p_from_year_id uuid, p_to_year_id uuid, p_mappings jsonb, p_overrides jsonb default '[]', p_exclude uuid[] default '{}') returns jsonb`.** Security definer, `search_path=''`, single `public.*` function with no `app.*` twin (precedent 0017 `enqueue_term_invoices`), `execute` to `authenticated` only. `p_mappings` = `[{"from_section_id", "to_section_id" | null}]`, `p_overrides` = `[{"student_id", "to_section_id"}]`.
  - Null uid → `unauthenticated`. Institution comes from the from-year row, never an argument; from-year missing → `not_found`; caller not owner/principal/admin there (`academics.manage`) → `forbidden`.
  - `validation_failed` when: the two years are not in the same institution; `to.starts_on <= from.starts_on`; a `from_section_id` is not in the from-year; a non-null target section is not in the to-year; an override student has no active from-year enrolment.
  - Candidates = active from-year enrolments in mapped sections ∪ override students, minus `p_exclude` (exclude wins), locked `for update`.
  - Per candidate: student already active in the to-year → untouched, id goes to `skipped_student_ids`. Otherwise the old row → `completed` with `ended_on = from.ends_on`. Target = override else mapping. Non-null target → new `active` enrolment (`started_on = to.starts_on`, `roll_no` null) + event `promoted` (from/to ids). Null target → student `alumni` + event `graduated`, no new enrolment, memberships untouched.
  - One `batch_id` per call; one audit `lifecycle.promoted` with year ids + counts only. Returns `{batch_id, promoted, graduated, skipped_student_ids}`.
  - **Idempotent:** a completed row is never a candidate again, so a re-run (or a concurrent second run after the row lock re-checks `status = 'active'`) returns zeros and writes nothing. The call is one transaction: all-or-nothing. Section capacity is not enforced.
- **`public.exit_student(p_student_id uuid, p_kind text, p_reason text, p_left_on date default null, p_destination_school text default null, p_conduct text default null) returns jsonb`.** Definer, same shape. Institution from the student row.
  - Student missing → `not_found`; caller not owner/principal/admin/admissions there (`student.write`) → `forbidden`; student status ≠ `active` → `invalid_state`; `p_kind` not in (`transferred_out`, `withdrawn`), `transferred_out` without destination, reason outside 3–500 chars, or `left_on` (default `current_date`) after today or before the active enrolment's `started_on` → `validation_failed`.
  - TC number: `app.next_sequence(inst, 'tc_no')`. First, if `settings.numbering.tc_no` is missing, merge `"TC/{YYYY}/{SEQ:5}"` into that institution's `settings.numbering` (create_institution sets no numbering patterns).
  - `tc_snapshot` is built in SQL from rows (lesson 3), never from caller JSON: `{tc_no, student_name, admission_no, dob, gender, primary_guardian_name, grade, section, academic_year, admitted_on (earliest enrolment started_on), left_on, kind, reason, destination_school, conduct, dues_outstanding (sum of invoices total − paid_total where status in issued|part_paid; numeric, lesson 8), issued_at}`.
  - Effects: active enrolment (if any) → `withdrawn` + `ended_on`; student → `withdrawn`; the student's `role='student'` memberships → `disabled`; memberships of linked guardians with no other linked student whose status is `active` → `disabled`; skip any membership whose `user_id` is the caller (0033 self-edit guard; staff-parent edge, debt row); pending invitations (`accepted_at` and `revoked_at` null) for those student/guardian ids → `revoked_at = now()`.
  - Event row + audit `lifecycle.transferred_out` / `lifecycle.withdrawn` with student id + tc_no only (no reason text: it may hold PII). Returns `{event_id, tc_no}`.
  - Guardians who keep an active membership (a sibling still active) keep reading the withdrawn child's records, including the TC. No undo or re-admission path (debt row).
- **`public.link_guardian(p_student_id uuid, p_relationship text, p_is_primary boolean default false, p_guardian_id uuid default null, p_full_name text default null, p_phone text default null, p_email text default null) returns jsonb`.** Definer, same shape, `student.write` roles on the student's institution.
  - Exactly one of `p_guardian_id` / (`p_full_name` + `p_phone`), else `validation_failed`. A guardian id outside the student's institution → `validation_failed` (lesson 2).
  - New-guardian mode: find by `(institution_id, phone)` → reuse it (name/email untouched, `created = false`), else insert (`created = true`).
  - `p_is_primary` → clear the student's current primary first, then upsert `(guardian_id, student_id)` (`on conflict` update relationship/is_primary). Audit ids only. Returns `{guardian_id, created}`.
  - Definer because a plain invoker insert into `guardian_students` recurses (DBT-45) and the primary swap must be atomic. DBT-45 note: Postgres never inlines SECURITY DEFINER SQL functions, so the recorded cause (`app.my_student_ids` inlining) is doubtful. The likely cycle is `guardian_students_insert` check → `guardians_select` teacher branch subquery → `guardian_students` policy. Not verified here (no DB commands in planning); T10 records it. M14 does not fix it.
- **`people.student.update` / `people.guardian.update`** are plain RLS updates (invoker, same shape as `people.staff.upsert`): `.eq('institution_id', ctx.institution.id)` + `maybeSingle()`; zero rows → `not_found`; 23505 → `conflict` with `fieldErrors.admissionNo` / `fieldErrors.phone`; 42501 → `forbidden`. Editable: student `firstName`, `lastName` (nullable), `dob`, `gender` (male|female|other, as imports), `admissionNo`; guardian `fullName`, `phone`, `email` (nullable). Never `status`, `user_id`, `details`, `photo_path`. Audit: entity id + changed field names only, no values (lesson 10).
- **Permissions** (no new keys, no grant changes): `lifecycle.promote` = `academics.manage` (owner/principal/admin; year rollover is structural, 07 §2.2). `lifecycle.transfer`, `lifecycle.withdraw`, `people.student.update`, `people.guardian.update`, `people.guardian.link` = `student.write` (owner/principal/admin/admissions; 07 §2.2 has no `guardian.write`, and `student.write` is exactly the guardians/guardian_students write role set). `lifecycle.history` = `student.read` (RLS scopes). Each RPC re-checks the same role set.
- **Modules** (owner directive): `lifecycle.promote`, `lifecycle.transfer`, `lifecycle.withdraw` and `lifecycle.history` declare `module: "student_lifecycle"`; the `people.*` actions stay core (no module). If MOD's `ModuleKey` lacks `student_lifecycle`, T6 adds it (default enabled). Module gating is app-layer only: the RPCs do not check it, role checks still hold (T10 debt row). One test: module disabled → `forbidden` (T6).
- **Names:** the plan shorthand (`student.promote`, `student.transfer/withdraw`, `student.update`, `guardian.update/link`) maps to the `<module>.<entity>.<verb>` names above.
- **ErrorCode map:** `unauthenticated` (null uid in an RPC) · `forbidden` (permission, module, RPC role check, 42501) · `not_found` (student/guardian/year missing; zero-row RLS update) · `validation_failed` (Zod; foreign or mismatched ids; dates; kind/destination) · `conflict` (23505 on admission_no / phone) · `invalid_state` (status not active; illegal transition; direct status write). RPC `code:*` → `mapSqlError`; never raw SQL text.

Routing: T1 haiku none [] ; T2 sonnet exclusive [] ; T3 sonnet exclusive [2] ; T4 sonnet exclusive [3] ; T5 sonnet exclusive [4] ; T6 sonnet tests [1,3,4] ; T7 sonnet tests [1,5] ; T8 sonnet tests [1,2] ; T9 sonnet tests [6,7,8] ; T10 haiku none [9]

T2–T5 all edit the one unmerged 0076 file and run `db:reset`/`db:types`, so they run strictly in order. Every new action: manifest import + C-03 fixture. Every new query: `query-defs.ts` + `all-queries.ts` + smoke sample in `tests/db/api-query-route.test.ts`.

---

### Task 1: M14-T1 Lifecycle + people Zod schemas (Haiku)
READ: BRIEF-COMMON.md; rulings; `src/modules/people/schemas.ts`, `src/lib/schemas/common.ts`
FILES: `src/modules/lifecycle/schemas.ts` (new); `src/modules/people/schemas.ts` (edit, append only); `tests/unit/lifecycle-schemas.test.ts` (new)
EXPORTS (all `.strict()`, plus `z.infer` types): lifecycle — `PromoteSchema` {fromYearId, toYearId (refine ≠), mappings: {fromSectionId, toSectionId: uuid | null}[] 1–200 (unique fromSectionId), overrides?: {studentId, toSectionId}[] ≤ 500 (unique studentId), exclude?: uuid[] ≤ 2000 (refine: no id in both overrides and exclude)}; `TransferSchema` {studentId, reason trimmed 3–500, leftOn? isoDate, destinationSchool 2–200, conduct? ≤ 100}; `WithdrawSchema` = same with destinationSchool optional; `HistorySchema` {studentId}. people — `StudentUpdateSchema` {studentId, firstName? shortText, lastName? shortText | null, dob? isoDate, gender? enum male|female|other, admissionNo? 1–40} (refine ≥ 1 field besides studentId); `GuardianUpdateSchema` {guardianId, fullName? shortText, phone? phoneIN, email? email ≤ 200 | null} (≥ 1 field); `GuardianLinkSchema` {studentId, relationship enum father|mother|legal_guardian|grandparent|other, isPrimary? boolean, guardianId? uuid, guardian? {fullName, phone: phoneIN, email?}} (refine exactly one of guardianId / guardian).
TEST FIRST: valid inputs parse; same from/to year rejected; duplicate fromSectionId rejected; a student in both overrides and exclude rejected; transfer without destinationSchool rejected; StudentUpdate with only studentId rejected; `status` key rejected (strict); link with both guardianId and guardian rejected; phone "12345" rejected.
ACCEPT: `pnpm test tests/unit/lifecycle-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M14-T2 Migration 0076 part 1 — events table, RLS, status guards
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000005_academics.sql` (enrolments, history trigger), `…0025_staff_read_scope.sql` (SELECT shape), `…0069_timetable.sql` (guard + grants); `tests/db/academics.test.ts` AC3
FILES: `supabase/migrations/20261028000076_student_lifecycle.sql` (new); `tests/db/lifecycle-rls.test.ts` (new); `tests/db/academics.test.ts` (AC3 step only); + `src/lib/db/types.ts` (regen), `tests/security/rls-expectations.ts` (one entry)
EXPORTS: `student_lifecycle_events` table, checks, indexes, triggers, RLS, grants per rulings; `app.guard_enrolment_status()`, `app.guard_student_status()` + triggers.
TEST FIRST: admin direct `enrolments.status` update → `invalid_state`; admin direct `students.status` update → `invalid_state`; admin insert of an enrolment with status `completed` → rejected; postgres-session status update passes (seed path); authenticated insert into `student_lifecycle_events` → denied; postgres update of an event row → blocked; guardian reads own child's event, not another family's; teacher of the section reads it, teacher of another section does not; accountant reads it.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/lifecycle-rls.test.ts tests/db/academics.test.ts`; `pnpm test:security` (if a generic write probe sets `status`, update its expectation — say so); `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M14-T3 Migration 0076 part 2 — `promote_students`
READ: BRIEF-COMMON.md; rulings; T2 migration; `…0069_timetable.sql` `publish_timetable` (definer + GUC + audit shape)
FILES: `supabase/migrations/20261028000076_student_lifecycle.sql` (append); `tests/db/lifecycle-promote-rpc.test.ts` (new); + types regen
EXPORTS: `public.promote_students(...)` per rulings.
TEST FIRST: admin maps sections A→A2, B→B2: old rows `completed` with `ended_on = from.ends_on`, new rows `active` with `started_on = to.starts_on`, `promoted` events share one batch_id, history rows active→completed carry `changed_by`; null target graduates (row completed, student `alumni`, `graduated` event, no new row); an override moves one student to a same-grade section; an excluded student stays active in the from-year; same call again → zeros, row counts unchanged; a student already active in the to-year → in `skipped_student_ids`, old row still active; target section from the from-year or another institution → `validation_failed`; admissions and teacher → `forbidden`.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/lifecycle-promote-rpc.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M14-T4 Migration 0076 part 3 — `exit_student` (TC snapshot, portal access)
READ: BRIEF-COMMON.md; rulings; T2–T3 migration; `…0001_foundation.sql` `app.next_sequence`; `…0064_onboarding.sql` (invitations); `…0038_membership_identity_immutable.sql` (guard)
FILES: `supabase/migrations/20261028000076_student_lifecycle.sql` (append); `tests/db/lifecycle-exit-rpc.test.ts` (new); + types regen
EXPORTS: `public.exit_student(...)` per rulings.
TEST FIRST: admin withdraws: enrolment `withdrawn` + `ended_on`, student `withdrawn`, history row active→withdrawn with `changed_by` (moved from academics AC3), event `tc_no` = `TC/<YYYY>/00001` and snapshot names/section/year come from rows, `dues_outstanding` reflects one unpaid invoice; the next exit gets `…00002`; student's membership → `disabled` and their pending invitation revoked; guardian with only this child → `disabled`, guardian with an active sibling → stays `active`; `transferred_out` without destination → `validation_failed`; future `left_on` → `validation_failed`; second exit of the same student → `invalid_state`; teacher → `forbidden`; unknown student id → `not_found`.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/lifecycle-exit-rpc.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M14-T5 Migration 0076 part 4 — `link_guardian`
READ: BRIEF-COMMON.md; rulings; `…0066_imports.sql` `app.import_insert_guardian_student` (DBT-45 comment); `…0020_rls_performance.sql` guardians/guardian_students policies
FILES: `supabase/migrations/20261028000076_student_lifecycle.sql` (append); `tests/db/guardian-link-rpc.test.ts` (new); + types regen
EXPORTS: `public.link_guardian(...)` per rulings.
TEST FIRST: link an existing same-institution guardian as primary → the old primary is demoted, exactly one primary remains; new phone → guardian created (`created = true`); existing phone → reused (`created = false`), name unchanged; re-linking the same pair updates relationship with no duplicate row; guardian of another institution → `validation_failed`; both guardian id and new-guardian fields → `validation_failed`; teacher → `forbidden`; after linking, a guardian with an active membership reads the new child through `students` RLS.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/guardian-link-rpc.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M14-T6 Lifecycle actions (module `student_lifecycle`)
READ: BRIEF-COMMON.md; rulings; T1 schemas; `src/modules/timetable/actions.ts` (RPC wrapper + `mapSqlError` style); MOD's `module` field on `defineAction`
FILES: `src/modules/lifecycle/actions.ts` (new, `"use server"`); `tests/db/lifecycle-actions.test.ts` (new); + `src/app/api/v1/actions/all-actions.ts` line + 3 C-03 fixtures in `tests/security/escalation.test.ts` (+ one `ModuleKey` line in MOD's registry if `student_lifecycle` is missing)
EXPORTS (all `module: "student_lifecycle"`; camelCase → RPC snake_case; audit stays in SQL, no TS duplicate): `lifecycle.promote` (`academics.manage`) → `{ batchId: string; promoted: number; graduated: number; skippedStudentIds: string[] }`; `lifecycle.transfer` (kind `transferred_out`) and `lifecycle.withdraw` (kind `withdrawn`), both `student.write` → `{ eventId: string; tcNo: string }`.
TEST FIRST: admin promote → counts, re-run → zeros; admissions promote → `forbidden`; withdraw → `tcNo` `TC/<YYYY>/00001`, second withdraw → `invalid_state`; transfer without destinationSchool → `validation_failed`; teacher withdraw → `forbidden`; with `student_lifecycle` disabled for the institution (MOD's disable path) → promote `forbidden`.
ACCEPT: `pnpm test:db tests/db/lifecycle-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M14-T7 People student/guardian actions (core)
READ: BRIEF-COMMON.md; rulings; T1 schemas; `src/modules/people/actions.ts` (`upsertStaff` style, 23505 mapping)
FILES: `src/modules/people/actions.ts` (edit); `tests/db/people-student-guardian-actions.test.ts` (new); + 3 C-03 fixtures (`people/actions` is already in the manifest)
EXPORTS (all `student.write`, no module): `people.student.update` → `{ id, admissionNo, firstName, lastName, dob, gender }`; `people.guardian.update` → `{ id, fullName, phone, email }`; `people.guardian.link` → RPC → `{ guardianId: string; created: boolean }`.
TEST FIRST: admissions updates a student's name and dob; duplicate admissionNo → `conflict` with `fieldErrors.admissionNo`; another institution's student → `not_found`; teacher → `forbidden`; guardian phone clash → `conflict` with `fieldErrors.phone`; link creates then reuses a guardian by phone; audit rows hold no phone/email values.
ACCEPT: `pnpm test:db tests/db/people-student-guardian-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: M14-T8 Query `lifecycle.history`
READ: BRIEF-COMMON.md; rulings; `src/modules/timetable/queries.ts` + `query-defs.ts` (pattern)
FILES: `src/modules/lifecycle/queries.ts`; `src/modules/lifecycle/query-defs.ts`; `tests/db/lifecycle-queries.test.ts`; + `src/app/api/v1/query/all-queries.ts` line + smoke sample
EXPORTS: `lifecycle.history` {studentId} (`student.read`, `module: "student_lifecycle"`, RLS is the only filter, no fixtures imported) → `{ enrolments: { id, academicYear, grade, section, rollNo, status, startedOn, endedOn }[]; events: { id, kind, effectiveOn, reason, tcNo, tcSnapshot, createdAt }[] }`, enrolments by `startedOn`, events by `createdAt`.
TEST FIRST (rows inserted via `sql`): admin sees the completed and the active enrolment plus the `promoted` event; guardian sees own child's TC snapshot; guardian asking for another family's child → empty arrays; teacher of the current section sees the history, teacher of another section → empty.
ACCEPT: `pnpm test:db tests/db/lifecycle-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 9: M14-T9 Acceptance over HTTP
FILES: `tests/db/lifecycle-acceptance.test.ts`
TEST: admin `POST /api/v1/actions/lifecycle.promote` maps one section → 200 with counts; same request again → 200 with zeros; `GET /api/v1/query/lifecycle.history` for a promoted student → both enrolment rows (completed + active). Admin withdraws a student who has a portal login → 200 `{ tcNo }`; that student's token on `people.getMyStudent` → 404 (no active membership, `getTenantContext` notFound); their only-child guardian → 404; a guardian with an active sibling → 200 and still reads the TC via `lifecycle.history`. Teacher `POST lifecycle.withdraw` → 403.
ACCEPT: `pnpm test:db tests/db/lifecycle-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 10: M14-T10 Docs (Haiku)
FILES: `docs/planning/coolskool/07-security-and-ai-governance.md` §4 definer row (`public.promote_students`, `public.exit_student`, `public.link_guardian`, guards `app.guard_enrolment_status`/`app.guard_student_status`, GUC `app.allow_lifecycle`); `docs/planning/coolskool/05-data-architecture.md` (§2 row for `student_lifecycle_events`; §3 ownership row `lifecycle | student_lifecycle_events | people, academics`; enrolments note: `transferred` = intra-school move, exits use `withdrawn`); `docs/planning/coolskool/12-decision-log.md` (DBT-45 note from rulings; new debt rows: no undo/re-admission; no TC for alumni; module gating app-layer only; staff-parent's own guardian membership is not disabled on exit; `students.details` not editable)
ACCEPT: rows match the merged migration and actions; no other files touched
REPLACES FIXTURE: none

---

Controller after T9: security review (Sonnet) on the 0076 diff + actions; full gate; `10-backlog-index.md` §3 0076 → built; commit/push; hosted push owner-run; `DONE M14 <sha>`.
