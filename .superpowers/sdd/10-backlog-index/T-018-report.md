Packet: T-018 Exam setup, marks entry, verification UI

## Files changed
- `supabase/migrations/20261028000018_exams_entry.sql` (new — the one migration the lead authorized)
- `src/lib/db/types.ts` (regenerated, additions-only)
- `src/modules/exams/{schemas,actions,queries}.ts` (new)
- `src/modules/exams/components/{ExamForm,PaperGrid,MarksEntryGrid,VerificationPanel}.tsx` (new)
- `src/app/(tenant)/[institution]/exams/{page.tsx,new/page.tsx,[examId]/page.tsx,[examId]/papers/[paperId]/page.tsx}` (new)
- `tests/unit/exams-schemas.test.ts`, `tests/db/exams-actions.test.ts`, `e2e/j09-marks-entry.spec.ts` (new)
- `docs/planning/coolskool/10-backlog-index.md` §3 (new bullet for `20261028000018`)
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (appended the new definer functions/guard to the SQL-functions row)
- `src/lib/nav.ts` — **not touched**: `/exams` already existed (`exam.result.read`), which is a superset of every role that holds `exam.manage`/`exam.marks.enter` per the matrix, so the existing nav line and `tests/unit/nav.test.ts` already cover it correctly. Confirmed by re-reading the permission matrix, not just re-running `navItemsFor`.

## Behavior implemented
- `createExam`/`createExamPapers` — direct RLS inserts (`exam.manage`), every foreign id (`termId`/`classSectionId`/`subjectId`) proven to belong to `ctx.institution` in the action before insert.
- `openMarksEntry`/`closeMarksEntry`/`reopenMarksEntry` — thin action wrappers over new security-definer RPCs implementing 06 §W7's `draft->marks_entry->verification->marks_entry` edges.
- `enterMarks` — thin wrapper over `public.enter_marks`, the single-transaction RPC T-017's report named as follow-up debt.
- `verifyExam` — thin wrapper over the new `public.exam_verification` wrapper (0009's `app.exam_verification` had none).
- UI: `ExamForm`, `PaperGrid` (sections × subjects checkbox matrix, one shared max/pass% computed from `settings.exams.pass_percentage`, default 80/26.4), `MarksEntryGrid` (client, absent checkbox, dirty tracking — only changed rows are sent), `VerificationPanel` (missing/out-of-range counts + the four transition buttons). Pages: `/exams`, `/exams/new`, `/exams/[examId]`, `/exams/[examId]/papers/[paperId]`.

## RPCs and guards (file:line, `supabase/migrations/20261028000018_exams_entry.sql`)
- `app.guard_exam_status()` trigger — 24:55. BEFORE UPDATE on `public.exams`; rejects any direct `status` change (including straight to `published`, or backwards out of it) unless `app.allow_exam_status_change` is set for the transaction, the JWT role claim is `service_role`, or `session_user='postgres'`. One shared GUC, not per-transition names — each RPC below already validates its own specific precondition before setting it, so the GUC alone is sufficient.
- `app.open_marks_entry`/`public.open_marks_entry` — 70:127. `draft`->`marks_entry`; requires at least one `exam_papers` row; role-gated `app.exam_write_roles()`.
- `app.close_marks_entry`/`public.close_marks_entry` — 129:186. `marks_entry`->`verification`.
- `app.reopen_marks_entry`/`public.reopen_marks_entry` — 188:246. `verification`->`marks_entry` ("unpublished only" falls out for free: `published` has no edge back into `marks_entry`).
- `app.publish_exam_results` — 252 (`create or replace` of 0009's function). Byte-for-byte identical except one added line (`perform set_config('app.allow_exam_status_change','on',true)`) immediately before its existing status UPDATE, so the new guard doesn't reject its own `verification`->`published` transition.
- `public.exam_verification(p_institution_id, p_exam_id)` — 378:406. Wraps 0009's internal-only `app.exam_verification(p_exam_id)`; role-gated `app.exam_write_roles()` (07 §2.2 has no separate "exam.verify" row).
- `app.enter_marks`/`public.enter_marks` — 423:570. Single transaction: role check (`app.exam_write_roles()` OR a teacher with a `subject_assignments` row for exactly the paper's section+subject), exam-status check, batch validation (1-60 rows, no duplicate `student_id`, `0<=marks_obtained<=max_marks` xor `is_absent`, active enrolment), then per row: skip if unchanged, else insert-then-supersede (same order as `apply_recheck_decision`, required by the deferred one-current-row trigger). Aggregate audit row (`exam.marks.entered`, counts + student ids only) in addition to `app.marks_revision_audit`'s per-row AFTER INSERT rows (dual grain, same pattern as `publish_exam_results`).

## Status-transition findings
`exams_update` (0009) lets any `exam.manage` role UPDATE `status` directly via RLS to anything, including `published` (skipping the results snapshot) or backwards out of it — same class of hole 0014/0016 closed for attendance/admissions/enquiries. Fixed with `app.guard_exam_status` above. Verified with a real authenticated client (not the test suite's superuser `postgres` connection) attempting a direct `.from("exams").update({status:"published"})` while `draft`, and a direct backwards write attempt after reaching `published` via the real RPC chain — both rejected with `code:invalid_state`; status unchanged in both cases (`tests/db/exams-actions.test.ts`, "app.guard_exam_status" test).

## Scope tests
- `tests/db/exams-actions.test.ts`: a teacher is forbidden from `createExam`/`createExamPapers`/`openMarksEntry` (no `exam.manage`); a teacher who teaches the section for a DIFFERENT subject is forbidden from `enterMarks` for that paper (subject-level scope, not section-level — same DBT-19 lesson as T-022's assignments).
- J-09 end to end at the action layer: a teacher enters marks for 2 enrolled students (v1), an identical resubmit creates 0 new versions (06 §W7 "Duplicates"), changing one mark supersedes v1 with v2; verification lists both missing before, then clean after.
- Marks above `max_marks` → `validation_failed`; marks entry attempted while the exam is still `draft` → `invalid_state`.

## Tests run (actual output)
1. `pnpm db:reset` → clean apply, migration `20261028000018_exams_entry.sql` applied after `...016`, seed completed (3024 students etc.).
2. `pnpm vitest run --project db tests/db/exams-actions.test.ts tests/db/exams-schema.test.ts` → **2 files, 16/16 passed** (8 new + T-017's existing 8 unaffected by the `create or replace`).
3. `pnpm test:security` → **2 files, 465/465 passed** (unchanged from T-017's baseline — no new tenant tables, so nothing new for the generated RLS-expectations suite to cover).
4. `pnpm test:db` (full) → **30 files, 210/210 passed**.
5. `pnpm test` (unit) → **27 files, 296/296 passed** (includes `tests/unit/exams-schemas.test.ts`, 14/14).
6. `pnpm lint && pnpm typecheck` → clean for every file this packet touched (4 pre-existing, unrelated warnings in other packets' seed stubs).
7. `pnpm demo:reset` (`DEMO_RESET_ALLOWED=true`) → clean.
8. `pnpm playwright test e2e/j09-marks-entry.spec.ts` → **1/1 passed**, twice in a row (exam name includes `Date.now()` since `exams` has `unique(term_id, name)` and the spec reuses the seeded demo tenant across runs — a literal fixed name collided on the second run and surfaced as a generic `internal` error, which is how I found and fixed it).
9. Full `pnpm playwright test` (29 specs) → **27 passed, 2 failed** (`j03-pipeline.spec.ts`, `j04-decision.spec.ts`) — **not caused by this packet**. `git status` at the time showed uncommitted, in-progress edits to `src/modules/admissions/**`, `src/modules/finance/queries.ts`, and new `src/modules/people/**`/`src/app/.../students/**` from what is evidently a different, concurrently-running task — none of which this packet touched. Re-ran both specs alone (`--workers=1`) against the same dirty tree and they failed identically, ruling out worker-parallelism races; this packet's own `e2e/j09-marks-entry.spec.ts` passed cleanly in both the full run and isolation.

## Limitations / honesty label
No honesty-label concern — nothing simulated or limited is shown; students/guardians hitting `/exams` without `exam.manage`/`exam.marks.enter` see a plain "results appear in your portal" notice (report cards are T-019's).

## Security / integration risks
- `enterMarks`'s TS schema cannot know a paper's `max_marks` (only the RPC does), so `marksObtained > max` fieldErrors come from the RPC's `validation_failed`, not a client-side fieldError — acceptable, matches `createExamPapers`' `passMarks<=maxMarks` which IS checked client-side (both values are known there).
- `createExamPapers` has no app-level duplicate-pair guard; a duplicate `(classSectionId, subjectId)` row falls through to the table's `unique(exam_id, class_section_id, subject_id)` constraint and surfaces as a generic `internal` error (23505 isn't a `code:`-prefixed exception). Not reachable from the `PaperGrid` UI (a checkbox can't be double-selected) and not named by any acceptance criterion — flagged, not fixed, to stay inside the packet's time box.
- `getMyPapers`/`getPaperMarks` read via RLS `app.staff_roles()`/broad SELECT policies, so a teacher can view (read-only) a paper they don't teach by guessing its URL — cannot submit marks (the RPC blocks it) — same shape as the assignments module's existing read/write asymmetry (T-022).

## Follow-ups
- `createExamPapers` duplicate-pair UX (see above) — new debt entry if ever worth a friendlier error.
- No `publishExamResults` TS action exists yet — out of this packet's named scope (J-10/T-019's), the SQL RPC (`public.publish_exam_results`) already existed from T-017 and is `create or replace`d here only to add the transition GUC.

## New dependencies
None.

## Assumptions made
- `type` is the exams table's fixed check-constraint enum (`unit_test`/`half_yearly`/`annual`), not a per-institution `settings.exams.types` lookup — the DB constraint is the actual authority and all demo institutions share the same three values.
- Verification (`exam_verification`) is gated on `app.exam_write_roles()` — 07 §2.2 has no separate "exam.verify" permission row; it's part of `exam.manage`.
- `reopenMarksEntry`'s "(unpublished only)" packet note is satisfied structurally (the diagram's only backwards edge starts from `verification`, never from `published`), not by an extra explicit check.

## Fix round 1

Security review found 3 LOW issues, all fixed in-file (no new migration).

1. **Paper scope.** `getPaperMarks` (`src/modules/exams/queries.ts`) read any paper by UUID regardless of caller — RLS's `marks_select`/`exam_papers_select` are broad enough to let a teacher with `exam.marks.enter` open another paper's roster. Fixed: same scope rule as `getMyPapers` — owner/principal/exam_controller see any paper, a teacher only one they hold a `subject_assignments` row for (section+subject). Returns `null` (page already 404s) otherwise.
2. **Duplicate paper.** `createExamPapers` let a repeat `(section, subject)` pair hit 0009's `unique(exam_id, class_section_id, subject_id)` constraint and surface as a generic `internal` error (23505 isn't `code:`-prefixed). Fixed in `src/modules/exams/actions.ts`: narrowed on the constraint name (`exam_papers_exam_id_class_section_id_subject_id_key`) and mapped to `validation_failed` with a field error; any other 23505 still falls through to the generic handler.
3. **Cross-tenant test.** Added a db test with two institutions: `enter_marks` against another institution's paper → `not_found` (the paper lookup is institution-scoped); against another institution's student on an otherwise-valid own-institution paper → `validation_failed` ("not actively enrolled" — there's no row to 404 on, since the paper itself is local; the enrolment check catches it instead). Same no-leak, no-write property either way.

New tests (`tests/db/exams-actions.test.ts`): paper-scope hide/show, duplicate-paper `validation_failed`, cross-institution paper/student via `withTwoInstitutions`.

### Fix round 1 — verification (actual output)
1. `pnpm vitest run --project db tests/db/exams-actions.test.ts tests/db/exams-schema.test.ts` → **2 files, 19/19 passed**.
2. `pnpm test` → **27 files, 296/296 passed**.
3. `pnpm lint` → clean (same 4 pre-existing, unrelated warnings).
4. `pnpm typecheck` → clean (not asked for, ran anyway since TS files changed).

Did not run `pnpm db:reset`/`pnpm test:db`/`pnpm test:security` this round — T-028 now owns the DB; only this packet's own db test files were run, per the coordinator's instruction.
