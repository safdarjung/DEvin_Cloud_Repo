# M09 — Assignment submissions + feedback

Source: `07-master-plan-v1-v2.md` §3 M9. Migration `0071` (claimed). No new deps. Owning module `src/modules/academics` (owns `assignments`, `assignment_submissions`; 05 §2.3). `documents` (M05) gains the `submission` entity it left open. Replaces no `src/modules/fabric/types.ts` fixture (none models submissions); the `state='submitted'` rows feed the "Assignments awaiting review" insight (`core/demo/fixtures.ts:148`, M19 detector).

Exists already (do not rebuild): `assignment_submissions` table (0005: id, institution_id, assignment_id, student_id, submitted_at, content jsonb, score numeric, feedback, unique `(assignment_id, student_id)`), its 3 policies (student INSERT/UPDATE own row incl. `score`/`feedback` = self-grading hole, closed here), assignment create/update/publish actions, `academics.listStudentAssignments`, `document.requestUpload/confirmUpload/getReadUrl/delete`, `documents.listForEntity`. No seed: 05 §8.2 asserts 0 homework assignments (J-08 creates the quiz live).

Rulings:
- **One row per (assignment, student); resubmit = in place.** Keep 0005's unique. Resubmit overwrites `content`, `attempt + 1`, `submitted_at = now()`, recomputes `is_late`. Allowed only while `status = 'submitted'`; once `graded` → `invalid_state`. No version table (debt row, T8).
- **Columns added (0071):** `status text not null default 'submitted' check in ('submitted','graded')`; `attempt int not null default 1 check (attempt >= 1)`; `is_late boolean not null default false`; `max_score numeric(6,2) check (max_score > 0 and max_score <= 1000)`; `graded_by uuid references profiles(id)`; `graded_at timestamptz`; `score` → `numeric(6,2)`. Checks: `score is null or score between 0 and max_score`; `(status = 'graded') = (score is not null and max_score is not null and graded_at is not null and graded_by is not null)`; `feedback is null or length(feedback) <= 2000`; `content is null or jsonb_typeof(content) = 'object'`. `content` = `{text?: string ≤ 5000, answers?: string[] ≤ 30 × ≤ 500}`, built in SQL from params (`jsonb_strip_nulls`).
- **Late flag** computed in SQL at submit: `due_at is not null and now() > due_at`. Queries compute it for unsubmitted rows (`dueAt < now`). Late submissions are accepted (flagged).
- **RLS** (`assignment_submissions`, drop 0005's 3 policies). SELECT = 07 §2.2 `assignment.read`: owner/principal/admin via `institution_id = any((select app.my_institution_ids(array['owner','principal','admin'])))`; teacher = 0034's answer-key scope on the parent assignment (`a.class_section_id = any((select app.my_class_teacher_section_ids()))` or `(a.class_section_id, a.subject_id) in (select … from app.my_taught_section_subjects() t)`, `a.institution_id` bound); student/guardian `student_id = any((select app.my_student_ids()))`. **No INSERT/UPDATE/DELETE policy** — writes only through the two definers, so no guard trigger is needed (table grants unchanged). `rls-expectations.ts`: read `[owner, principal, admin, teacher, student, guardian]`, write `[]`.
- **Definers** (app.* core + `public.*` thin wrapper, same split as `publish_timetable`; `search_path=''`, qualified names, execute `authenticated` only, app.* revoked from public/anon/authenticated; audit inside SQL via `app.audit`, actions do not audit again):
  - `public.submit_assignment(p_assignment_id uuid, p_text text default null, p_answers jsonb default null) returns public.assignment_submissions`. Student id is **derived** (`app.own_student_id(a.institution_id)`), never a parameter. Order: no uid → `unauthenticated`; assignment missing or `draft` → `not_found`; caller not an active student of that institution, or not actively enrolled in `a.class_section_id` → `forbidden`; `closed` → `invalid_state`; text > 5000 / answers not a string array ≤ 30 × ≤ 500 → `validation_failed`; `insert … on conflict (assignment_id, student_id) do update … where assignment_submissions.status = 'submitted'`, no row back → `invalid_state` (already graded). Audits `assignment.submitted` {attempt, isLate}.
  - `public.grade_submission(p_submission_id uuid, p_score numeric, p_max_score numeric, p_feedback text default null) returns public.assignment_submissions`. no uid → `unauthenticated`; submission missing → `not_found`; caller not owner/principal of the institution and not teacher-in-scope (same scope as SELECT teacher branch) → `forbidden` (admin cannot grade: no `assignment.manage`); `0 < max ≤ 1000`, `0 ≤ score ≤ max`, feedback ≤ 2000 → else `validation_failed`. Sets status `graded`, `graded_by = app.current_user_id()`, `graded_at = now()`. Re-grade (graded → graded) allowed. Audits `assignment.graded` {regrade} — ids/state only, no score text (lesson 10).
- **Documents (`submission` entity, 0071 drops + recreates 0067's three policies, every existing branch unchanged):** SELECT `or (entity_type = 'submission' and exists (select 1 from public.assignment_submissions s where s.id = documents.entity_id and s.institution_id = documents.institution_id))` — composes with submissions RLS, so whoever reads the submission reads its documents (storage policy composes in turn). INSERT role disjunction gains the student branch `entity_type = 'submission' and exists (own submission: same id + institution, s.status = 'submitted', s.student_id = app.own_student_id(documents.institution_id))`; binding clause gains `entity_type <> 'submission' or exists (submission in the same institution)` (closes 0067's noted gap for admins). UPDATE using/check gains `entity_type = 'submission' and created_by = app.current_user_id() and exists (own submitted submission)` (confirm + soft delete; 0067's guard trigger still limits columns). After grading the student can no longer attach or delete.
- **Permissions:** new `assignment.submit` = student only (07 §2.2 row `stu: s`). `document.write` += student (row note: "student: own ungraded submission only (s)"); RLS above is the scope. Grade = existing `assignment.manage` (owner, principal, teacher s). Queries = `assignment.read`.
- **Names** keep D41 `<module>.<fn>`: queries `academics.submissionsForAssignment`, `academics.mySubmissions` (master plan's `assignments.*`/`portal.*` are not module names). Actions `assignment.submit`, `assignment.grade`.
- **ErrorCode → HTTP** (existing envelope): `code:*` raised by the RPCs → `mapSqlError` → `unauthenticated` 401, `forbidden` 403, `not_found` 404, `validation_failed` 400, `invalid_state` 409. Documents `requestUpload` maps an insert `42501` → `forbidden` (student on a graded/foreign submission) instead of `internal`.
- **No notification, no AI, no badge.** Portal visibility is the notification (06 §W6 precedent). Real feature → no `<SimulatedBadge />`/`<LimitedBadge />`. No quiz auto-scoring: teacher enters `score`/`maxScore` (debt row); M20 mastery reads `score / max_score`.

Routing (owner: Haiku mechanical, Sonnet code/DB): T1, T3, T8 Haiku; T2, T4, T5, T6, T7 Sonnet. DB owner: T2 only (`db:reset` + `db:types`). Parallel: T1 ‖ T2 ‖ T3 → T4 ‖ T5 ‖ T6 ‖ T8 → T7.

Every new action: `src/app/api/v1/actions/all-actions.ts` import + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `query-defs.ts` (academics' file is already in `all-queries.ts`) + smoke sample in `tests/db/api-query-route.test.ts`. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`).

---

### Task 1: M09-T1 Permissions `assignment.submit`; `document.write` for student (Haiku)
READ: BRIEF-COMMON.md; rulings (Permissions); `src/lib/auth/permissions.ts` (student block); `tests/unit/permissions.test.ts` (matrix rows)
FILES: `src/lib/auth/permissions.ts` (edit: `Permission` union + student list); `tests/unit/permissions.test.ts` (edit: new row `["assignment.submit", f,f,f,f,f,f,f,true,f]`, `document.write` student → true); `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (edit: add `assignment.submit` row after `assignment.read`; `document.write` row text + `s` in stu column)
TEST FIRST: snapshot rows above fail before the edit.
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M09-T2 Migration 0071 — submission columns, RLS rewrite, submit/grade RPCs, documents submission branches
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000005_academics.sql` (table + 3 policies), `…0034_answer_keys_class_teacher.sql` (teacher scope), `…0067_documents.sql` (policies to recreate verbatim + new branches), `…0069_timetable.sql` (`publish_timetable` definer/wrapper/grants pattern)
FILES: `supabase/migrations/20261028000071_assignment_submissions.sql` (new); `tests/db/submissions-rls.test.ts` (new); `src/lib/db/types.ts` (regen); `tests/security/rls-expectations.ts` (edit `assignment_submissions`; `documents` write if the generated suite needs it — say so)
MIGRATION: `20261028000071_assignment_submissions.sql` (claimed)
EXPORTS: columns/checks/policies/definers exactly per rulings; `public.submit_assignment(uuid, text, jsonb)`, `public.grade_submission(uuid, numeric, numeric, text)`.
TEST FIRST: student submits to own section's published assignment → `submitted`, attempt 1, `is_late` false; resubmit → same id, attempt 2, content replaced; past `due_at` → `is_late` true; other section → `forbidden`; draft → `not_found`; closed → `invalid_state`; student direct PostgREST insert / update of `score` on `assignment_submissions` → denied; subject teacher grades → `graded`; teacher of another section and admin → `forbidden`; score > max → `validation_failed`; resubmit after grading → `invalid_state`; guardian reads own child's row with feedback, not another family's; student reads own only; student inserts a pending `submission` document for own submission, not for another's, not after grading; teacher in scope sees that document row.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/submissions-rls.test.ts tests/db/documents-rls.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M09-T3 Submission Zod schemas (Haiku)
READ: BRIEF-COMMON.md; `src/modules/academics/assignments.schemas.ts` + `src/lib/schemas/common.ts` (pattern)
FILES: `src/modules/academics/submissions.schemas.ts` (new); `tests/unit/submissions-schemas.test.ts` (new)
EXPORTS: `SubmitAssignmentSchema` {assignmentId uuid, text? trimmed 1–5000, answers? string 1–500 [] max 30}; `GradeSubmissionSchema` {submissionId uuid, score number ≥ 0, maxScore number > 0 ≤ 1000, feedback? trimmed 1–2000} refine `score ≤ maxScore` (path `score`); `SubmissionsForAssignmentSchema` {assignmentId uuid}; `MySubmissionsSchema` {studentId? uuid}. All `.strict()`; export inferred `*Input` types.
TEST FIRST: valid inputs parse; text 5001 chars rejected; 31 answers rejected; score 11 / maxScore 10 rejected on `score`; maxScore 0 rejected; unknown key rejected.
ACCEPT: `pnpm test tests/unit/submissions-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M09-T4 Actions `assignment.submit`, `assignment.grade`
READ: BRIEF-COMMON.md; rulings; T2 migration; T3 schemas; `src/modules/timetable/actions.ts` (RPC call + `throwMapped` style)
FILES: `src/modules/academics/submissions.actions.ts` (new, `"use server"`); `tests/db/submissions-actions.test.ts` (new); + `all-actions.ts` import + C-03 fixtures (`assignment.submit` → `{assignmentId}`, `assignment.grade` → `{submissionId, score: 1, maxScore: 10}`)
EXPORTS: `submitAssignment` = `assignment.submit` (permission `assignment.submit`) → `rpc("submit_assignment")` → `{ submissionId, attempt, isLate, status }`; `gradeSubmission` = `assignment.grade` (permission `assignment.manage`) → `rpc("grade_submission")` → `{ submissionId, status: "graded", score, maxScore }`. Errors via `mapSqlError`; no extra `audit()` (SQL audits).
TEST FIRST: student submits then resubmits (attempt 2); guardian → `forbidden` (permission); teacher grades; accountant grade → `forbidden`; resubmit after grade → `invalid_state`; grade of an unknown id → `not_found`.
ACCEPT: `pnpm test:db tests/db/submissions-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M09-T5 Documents: enable the `submission` entity
READ: BRIEF-COMMON.md; rulings (Documents, ErrorCode); `src/modules/documents/actions.ts` (`requireVisibleEntity`, `requestUpload`); `tests/db/documents-upload-actions.test.ts` (fixture + storage pattern)
FILES: `src/modules/documents/actions.ts` (edit: `ENTITY_TABLE.submission = "assignment_submissions"`, drop the "not supported yet" throw, map insert `42501` → `forbidden`); `tests/db/submission-documents.test.ts` (new)
EXPORTS: no new names; `document.requestUpload/confirmUpload/delete` now work for a student on own ungraded submission.
TEST FIRST: student requestUpload + confirmUpload on own submission → active; on another student's submission → `not_found`; after grading → `forbidden`; in-scope teacher `documents.listForEntity` + `document.getReadUrl` → ok; guardian of another family → empty / `not_found`; student requestUpload with `entityType: "student"` → `forbidden`.
ACCEPT: `pnpm test:db tests/db/submission-documents.test.ts tests/db/documents-upload-actions.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M09-T6 Queries `academics.submissionsForAssignment`, `academics.mySubmissions`
READ: BRIEF-COMMON.md; rulings; `src/modules/academics/assignments.queries.ts` (`listStudentAssignments` — reuse it), `src/modules/academics/query-defs.ts`
FILES: `src/modules/academics/submissions.queries.ts` (new, `import "server-only"`); `src/modules/academics/query-defs.ts` (edit: 2 `defineQuery`, permission `assignment.read`); `tests/db/submissions-queries.test.ts` (new); + smoke samples `academics.submissionsForAssignment: { assignmentId: UUID }`, `academics.mySubmissions: {}`
EXPORTS: `type SubmissionState = "not_submitted" | "submitted" | "graded"`; `submissionsForAssignment(ctx, assignmentId): Promise<SubmissionRosterRow[]>` — one row per active enrolment of the assignment's section (RLS-visible), left-joined submission: `{ studentId, studentName, rollNo, submissionId, state, attempt (0 if none), submittedAt, isLate, content, score, maxScore, feedback, gradedAt, documentCount }`, ordered by roll no; `mySubmissions(ctx, studentId?): Promise<MySubmissionRow[]>` — `studentId ?? ctx.membership.studentId` (null → `[]`), one row per published assignment from `listStudentAssignments`, left-joined: `{ assignmentId, title, subjectId, dueAt, submissionId, state, attempt, submittedAt, isLate, content, score, maxScore, feedback, gradedAt, documentCount }`. `documentCount` = active `submission` documents, one `.in()` query. No fixtures imported.
TEST FIRST: teacher roster lists every enrolled student with `not_submitted` for missing ones and `isLate` true past due; graded row carries score/feedback; guardian `mySubmissions` for own child shows feedback; for another family's child → `[]`; student defaults to own.
ACCEPT: `pnpm test:db tests/db/submissions-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M09-T7 Acceptance over HTTP
READ: BRIEF-COMMON.md; `tests/db/timetable-acceptance.test.ts` (HTTP + token pattern)
FILES: `tests/db/submissions-acceptance.test.ts` (new)
TEST: teacher via `/api/v1/actions/*` creates + publishes an assignment with a past `dueAt`; student `assignment.submit` → 200, `isLate` true; resubmit → attempt 2; student `document.requestUpload` + upload + `confirmUpload` on the submission; direct PostgREST insert into `assignment_submissions` with another student's id → denied; teacher `GET /api/v1/query/academics.submissionsForAssignment` → roster with the submission + `documentCount` 1; teacher `assignment.grade` → 200; accountant `assignment.grade` → 403; student resubmit → 409 `invalid_state`; guardian `academics.mySubmissions` for own child → feedback, for another family's child → `[]`.
ACCEPT: `pnpm test:db tests/db/submissions-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: M09-T8 Docs (Haiku)
READ: rulings; T2 migration (definer behaviour)
FILES: `docs/planning/coolskool/10-backlog-index.md` §3 (`0071` → built); `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (one row "SQL `security definer` — submissions (M09, `20261028000071`)": `submit_assignment`, `grade_submission`, mirror the M07 row's shape); `docs/planning/coolskool/03-feature-matrix.md` (F-ACA-06 Demo `impl`, Accept `tests/db/submissions-acceptance.test.ts`); `docs/planning/fabric/03-roadmap-and-tracker.md` (FB-EDU-08 → `live`); `docs/planning/coolskool/12-decision-log.md` §3 — three debt rows, next free DBT ids at write time (M08 may claim first): (a) resubmission overwrites in place, no prior-attempt history (attempt counter + audit only); (b) no quiz auto-score from the answer key — teacher enters score; (c) no `assignment.close` action, so submissions stay open after `dueAt` (flagged late).
ACCEPT: `pnpm lint` (no code); diff reviewed by controller
REPLACES FIXTURE: none

---

Controller after T7: security review (Sonnet) on the diff — focus self-grading hole closed, documents policy recreation unchanged for old branches; full gate; commit/push; hosted push owner-run (`--include-all`); `DONE M09 <sha>`.
