# T-042 report — Security suite completion + review fixes

Packet: T-042 Security suite completion + review fixes (DB owner; DBT-17/19/20/28/29/32 + T-041 found items a/b)

## Files changed
- Migrations (new, one concern each): `supabase/migrations/20261028000025_staff_read_scope.sql` (DBT-17) · `…026_assignments_write_scope.sql` (DBT-19) · `…027_applications_insert_guard.sql` (DBT-20) · `…028_website_live_guard.sql` (DBT-28) · `…029_membership_link_institution.sql` (DBT-32) · `…030_exams_portal_read.sql` (T-041 a) · `…031_revoke_enqueue_job.sql` (grants audit) · `…032_public_notices_events_live.sql` (review MEDIUM) · `…033_membership_role_guard.sql` (review HIGH) · `…034_answer_keys_class_teacher.sql` (found with DBT-19)
- TS: `src/lib/http/request.ts` (new: shared `readJsonBody` + `isCrossSiteRequest`), `src/app/api/ai/quiz/route.ts`, `src/app/api/public/enquiry/route.ts` (copies of `readJsonBody` removed), `src/lib/nav.ts` (`homePathFor`), `src/app/(tenant)/[institution]/page.tsx`
- Tests (new): `tests/security/{bola,escalation,rls-scope,write-guards,grants,csrf,public-site,allow-list,demo-reset}.test.ts`, `tests/unit/request-guards.test.ts`; (changed) `tests/unit/nav.test.ts`, `tests/security/rls-expectations.ts` (comments + assignments/guardian_students/exams read lists per 07 §2.2), `tests/db/guardian-students-institution-leak.test.ts` (attack fixture now rejected by DBT-32), `e2e/j00-login-smoke.spec.ts` (teacher lands via tenant root), `vitest.config.mts` (security project also runs the existing C-03/C-62/C-63/C-80/C-81/C-83/C-04 files)
- `scripts/audit-grants.sql` (new) · docs: `07 §4` definer row, `10 §3` numbers 0025–0034, `12 §3` DBT rows resolved + DBT-34/35 added

## Behavior implemented
- DBT-17: teacher reads students/enrolments/status history/guardian links only for own sections (new initPlan helper `app.my_taught_student_ids()`); assignments readable only by own/pri/adm, teacher own sections, student/guardian published own-section; guardian_students drops exam_controller (07 §2.2 guardian.read).
- DBT-19: assignments INSERT/UPDATE = owner/principal, class teacher (any subject, new `app.my_class_teacher_section_ids()`), or exact section+subject teacher; class_section/subject/curriculum_unit/created_by bound to the institution. 0034 gives answer keys the same class-teacher branch (was a latent 42501 → keyless quiz).
- DBT-20: non-trusted INSERT must start `submitted`; `application_no` always from the sequence and immutable on UPDATE.
- DBT-28: `websites.is_live` set/changed only by owner/principal/admin (trigger, insert+update).
- DBT-29: `/api/ai/quiz` refuses cross-site requests (Origin, else Sec-Fetch-Site) with 403 before any session/AI work; one shared body-cap reader; test proves auth cookies set via `src/lib/supabase/server.ts` are SameSite=Lax.
- DBT-32: membership links must point at a staff/guardian/student row of the same institution (every writer).
- (a) `exams_select_own_results`: guardian/student read a *published* exam only when one of their own/linked students has a result in it (results subquery keeps institution correlation, `(select app.my_student_ids())`). Report-card `exams(name)` embed now resolves.
- (b) `/[institution]` → `homePathFor`: dashboard.view → /dashboard, guardian/student → /portal, teacher (attendance.mark) → /attendance, else first permitted nav item, else /notifications.
- Review HIGH (found in triage, missed by reviewer): admin/principal could promote their own membership to owner over PostgREST. `guard_membership_write`: no self-edit; owner rows need an owner; principal rows need owner/principal.
- Review MEDIUM (security-reviewer): anon could read `is_public` notices/events of a never-live site → now require a live website.

## Security review (findings by severity)
- Pass 1 (security-reviewer over migrations 0001–0024, auth/actions/ai, module actions, API routes): CRITICAL none · HIGH none · MEDIUM 1 (notices/events anon w/o is_live) → fixed `0032`, test `tests/security/public-site.test.ts` · LOW none.
- Own triage: HIGH membership self-escalation → fixed `0033`, test `write-guards.test.ts` ("members cannot escalate") · LOW `app.enqueue_job` granted to authenticated → revoked `0031`, test `grants.test.ts`.
- Pass 2 (security-reviewer over this diff): HIGH 1 — guardian_students still readable by exam_controller (I had used the student.read list) → fixed in `0025` + expectations, test `rls-scope.test.ts` ("guardian.read: exam_controller…"). Nothing else.
- No commit refs: no git in this run; fix refs are the migration files above.

## Grants audit (`scripts/audit-grants.sql`, asserted by `tests/security/grants.test.ts`)
82 definers in app/public, 0 without `search_path=""`.
- app definer, no grants (25): add_enquiry_note, apply_recheck_decision, audit, claim_job, close_marks_entry, complete_job, convert_enquiry, decide_application, demo_reset, enqueue_job, enrol_applicant, enter_marks, exam_verification, generate_invoice, grade_for, next_sequence, open_marks_entry, publish_exam_results, publish_page, record_payment, reopen_marks_entry, request_recheck, start_recheck_review, submit_public_enquiry, term_attendance_percentage
- app definer, authenticated only (18 RLS helpers): current_user_id, guardian_student_ids, has_role, is_member, is_platform_admin, member_institutions, my_class_teacher_section_ids, my_institution_ids, my_student_ids, my_student_section_ids, my_taught_section_ids, my_taught_section_subjects, my_taught_student_ids, own_student_id, staff_id, staff_in_institution, teacher_sees_guardian, teaches_section; app invoker authenticated (5 role arrays): exam_roles, exam_write_roles, finance_roles, finance_write_roles, staff_roles
- public definer service_role only (3): jobs_claim, jobs_complete, submit_public_enquiry; authenticated+service_role (21): the 07 §4 RPCs; anon+authenticated (1): get_public_site
- 5 trigger functions keep default PUBLIC execute (block_page_version_mutation, guard_pages_published_version, marks_one_current_check, results_guard, results_one_current_check) — trigger-returning, not callable; left as is.

## Tests run (actual, final state)
- `pnpm db:reset && pnpm demo:reset` → ok (seed ~52s / ~70s)
- `pnpm test:security` → 17 files, 981 passed. C-ids in titles: C-01, 02, 03, 04, 10, 11, 12, 13, 14, 44, 54, 62, 63, 80, 81, 82, 83, 90, 91 (every 07 §6 id).
- `pnpm test:db` → 45 files, 310 passed · `pnpm test` → 33 files, 378 passed
- `pnpm test:e2e` (once, `E2E_RESET=true OLLAMA_MODEL=qwen2.5:3b`) → 79 passed (6.6m). Ran before `0034` and the guardian_students exam_controller fix; both only touch policies no spec exercises differently (answer keys widen for class teachers; exam_controller pages never list guardians).
- `pnpm lint` clean · `pnpm typecheck` clean · `pnpm db:types` → no diff (no public-schema shape change)
- TDD: every DBT/found test was run red before its migration/TS fix (escalation, csrf, allow-list, C-04 CLI tests were green on first run — they pin existing behaviour; escalation mutation-checked: a wrong fixture permission fails 3 cases).

## Tests not run and why
- Not run against hosted (local only, per packet). `pnpm build` not run (not in this brief).

## Limitations / honesty label
- No UI/feature labels changed. `isCrossSiteRequest` allows requests with neither Origin nor Sec-Fetch-Site (non-browser callers carry no ambient cookie).
- Guardians still can't read their own `guardians` row (DBT-23); bola test asserts current behaviour (DBT-35).

## Security / integration risks
- Teachers now see only own-section students on `/students` (matrix-correct; was institution-wide).
- Exam controller's student profile now shows no guardian list (guardian.read excludes them; previously links rendered with null guardians).
- Membership writes by owner/principal/admin are now restricted (no member-management UI exists yet).

## Follow-ups
- DBT-34 (new): 0009/0016/0018/0022 guards + `app.staff_in_institution` cast `request.jwt.claims` to jsonb without `nullif('')` — spurious "invalid input syntax for type json" on reused postgres sessions; fixed pattern used in 0027/0028/0033.
- DBT-35 (new): flip the bola `guardians` own-row expectation when DBT-23 lands.
- 07 §6: no C-id mechanism changed (C-90 now also has a source-walk test besides ESLint) — lead to confirm no table edit needed.

New dependencies (justification): none.

## Assumptions made
- Class teacher may write assignments of any subject in their section (matches `teacher-scope.ts managesWholeSection`); DBT-19's "subject-scoped" applies to non-class teachers.
- Teacher "own sections" for students = active enrolment in a class-teacher or subject-teacher section (same as the existing guardians_select teacher branch).
- Teacher home = /attendance (daily task, J-06); other staff without dashboard.view fall back to the first permitted nav link.
- Existing C-id tests in tests/unit and tests/db are run by the security project via `include` instead of being duplicated (packet: "otherwise reference").
- App-level membership policy for admins (manage admin-and-below, never self) chosen from 07 §2.1 ("principal: everything except member management of owners").

## Fix round 1 (independent review)

Every item got a failing security test first (red run recorded before each migration).

| # | Sev | Fix | Test |
|---|---|---|---|
| 1 | HIGH | `0035` `app.my_taught_student_ids`/`app.my_taught_section_subjects` join section/student/subject/membership on the row's own institution; `results_select` teacher branch now uses the fixed helper (it had its own unchecked enrolments subquery — the repro's results leak). `0036` `enrolments` + `subject_assignments` INSERT/UPDATE bind student/section/year/subject/staff to `institution_id`. | `tests/security/cross-tenant-teacher.test.ts`: A admin can't enrol B's student / use B's section, year, subject, staff; a malformed cross-institution enrolment (written past RLS) no longer exposes B's student, links or results to A's teacher. The `subject_assignments` path (marks/answer keys) was already blocked by nested RLS on exam_papers/assignments; the test now guards it. |
| 2 | MED | `0037` revoke UPDATE on `profiles` from anon/authenticated; grant UPDATE (`full_name`, `phone`, `avatar_path`) to authenticated. The app writes no profile column. | `write-guards.test.ts`: can't set own `is_platform_admin`; can still edit name/phone |
| 3 | LOW | `0038` `guard_membership_write`: `user_id`/`institution_id` never change on UPDATE | `write-guards.test.ts`: re-point to another user → forbidden; an admin of both A and B moving a membership A→B → forbidden |
| 4 | LOW | `0039` teacher INSERT branches require `created_by` = caller's own staff id; new invoker trigger `guard_assignment_created_by` makes `created_by` immutable (a self-referencing policy subquery hit 42P17, so a trigger is used). Co-teacher edits still work, as in teacher-scope.ts. | `rls-scope.test.ts`: forged `created_by` insert rejected; re-attribution rejected; editing a co-teacher's draft still ok |
| 5 | LOW | 0029 header (uncommitted, comment only) and 07 §4 now say `validate_membership_link` is and stays SECURITY DEFINER | n/a (docs) |
| 6 | LOW | `0040` `guardian_students_select` drops the `my_student_ids` branch: no student read (07 §2.2 guardian.read has no student column); the guardian keeps own links through the `guardian_id` branch. The portal (`listMyChildren`/`listGuardianChildren`) is unchanged; e2e J-07 green. | `rls-scope.test.ts`: student reads 0 links; guardian reads own |
| 7 | DBT-34 | `0041` `create or replace` of marks_guard, guard_application_decision, guard_enquiry_mutation, staff_in_institution, guard_exam_status, guard_recheck_request_status (from the live definitions) with `nullif(…, '')`. DBT-34 marked resolved. | `grants.test.ts`: no function in app/public casts the claim without nullif; `write-guards.test.ts`: reused session with an empty claim calls `staff_in_institution` fine |
| new | HIGH | `0042` found while triaging a flaky `tests/db/website-schema.test.ts` run: `guard_pages_published_version` (0010) used `current_setting('app.allow_publish', true) <> 'on'`, which is NULL (no raise) on a connection that never ran `publish_page`. Admissions (website.edit) could publish a draft directly over PostgREST, depending on pool history. Fixed with `coalesce(…, '')`. No other function has a `<>`-on-GUC check (checked via pg_proc). | `write-guards.test.ts`: admissions JWT on a brand-new session can't set `published_version_id` |

Docs: 07 §4 (helpers, profiles grant, nullif, created_by trigger, pages guard), 10 §3 (`0035`–`0042`), 12 §3 (DBT-34 resolved), `rls-expectations.ts` (guardian_students read list drops student).

Tests run (final state):
- Before each reset I waited for the lead's e2e to finish. `pgrep -f "playwright test"` never returns empty: it matches a stale 2-hour-old waiter shell whose own command line contains that string. I treated "no node Playwright runner except the MCP server" as the condition instead.
- `pnpm db:reset` ok · `pnpm demo:reset` ok · `pnpm db:types` no diff
- `pnpm test:security` 18 files, 996 passed · `pnpm test:db` 45 files, 310 passed · `pnpm test` 33 files, 378 passed
- `pnpm test:e2e` once (`E2E_RESET=true OLLAMA_MODEL=qwen2.5:3b`), after all round-1 migrations: 79 passed (5.8m)
- `pnpm lint` clean · `pnpm typecheck` clean

Risks: guardians no longer see a co-guardian's link rows (the co-guardian's `guardians` row was already hidden). Teachers can't change `created_by`, and neither can owner/principal outside service_role/postgres.
New dependencies: none.

## Fix round 2 (re-review)

| # | Sev | Fix | Test (red first) |
|---|---|---|---|
| 1 | MED | `0043` `create or replace app.marks_guard` (from the 0041 definition) with `coalesce(current_setting('app.allow_marks_revision', true), '') = 'on'`. On a fresh pooled session the old term was NULL, so `v_bypass` was NULL and the published-exam check never raised. Today `marks_insert` RLS still caught the write, so the guard was a dead second layer, not an open hole. | `write-guards.test.ts` "marks_guard on a fresh connection": connects as `authenticator` (exactly like PostgREST — a postgres session hits marks_guard's `session_user = 'postgres'` bypass) + `set role authenticated` as exam_controller. Red on the 0041 function (error came from RLS, not the trigger); green on 0043 (`code:invalid_state` from the trigger). |
| 1b | — | Grepped every `current_setting('app.…')` again. The only compares left without coalesce are plain `if … = 'on' then` (allow_reset in block_mutation, block_page_version_mutation, guard_pages_published_version, guard_exam_status, marks_guard, results_guard; allow_publish in block_page_version_mutation). There, NULL means false, so no bypass. | `grants.test.ts` "every app.* GUC compare outside a plain IF is NULL-safe" (red on the 0041 marks_guard line, green now) |
| 2 | LOW | `0044` `create or replace public.generate_invoice`: the role check is skipped only for the `service_role` JWT claim (`nullif` form); any other caller without a uid gets `code:unauthenticated`. Signed-in branch unchanged. The T-031 job handler (admin client) and `tests/db/finance.test.ts`'s service-role call still pass. | `write-guards.test.ts`: an `authenticated` session with no `sub` → `unauthenticated` (was `not_found` from the unchecked `app.generate_invoice`) |
| 3 | cosmetic | 0029 header and 07 §4 now say "definer since 0011" (0011 ran `alter function app.validate_membership_link() security definer`) | — |

Docs: 07 §4 (marks_guard, generate_invoice; the existing generate_invoice wording about a null uid is annotated), 10 §3 (`0043`–`0044`).

Tests (final, after `pnpm db:reset`): `test:security` 18 files, 999 passed · `test:db` 45 files, 310 passed · `test` 33 files, 378 passed · lint clean · typecheck clean · `db:types` no diff. e2e not run: no app code touched this round (migrations, tests and docs only).
