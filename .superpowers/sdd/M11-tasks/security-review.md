# M11 security review — question bank + exam schedule + report card HTML

Scope: files listed in the M11 packet only. RLS, action institution-binding,
error mapping, state guards, and report-card HTML renderer checked against
`docs/planning/fabric/06-backend-packets/M11-tasks.md` rulings,
`.superpowers/sdd/10-backlog-index/BRIEF-COMMON.md` lessons, and CLAUDE.md
non-negotiable rules.

## Findings

### HIGH — `src/modules/exams/report-card-html.ts`
`subject.grade` (line ~39, per-subject grade cell) and `result.grade` (line
~249, tfoot total-row grade cell) are interpolated into the HTML document
**without** `escapeHtml`. The same `result.grade` value *is* escaped two
lines later in the summary block (line ~262), so the gap is inconsistent,
not deliberate. M11 rulings explicitly require: "Renderer escapes every
interpolated string." `grade` is not system-fixed: it is the frozen
`results.grade` snapshot, sourced from `institutions.settings.grading_scales[].grade`,
which is free text validated only by `z.string().min(1)` (`src/modules/core/schemas.ts`
`GradingBand`) — no charset or max-length limit, settable by owner/principal/admin
via `institution.settings.manage`. The response's CSP
(`default-src 'none'`, no `script-src`) blocks inline-script execution in
compliant browsers, so this is not a reliable script-injection vector, but
it is a confirmed stored HTML-injection point into a document served to
guardians/students (layout breakage, spoofed content, phishing-style
defacement of a report card the family trusts). `tests/unit/report-card-html.test.ts`
does not cover grade escaping, and the task-9 completion report claims "Full
escape coverage" — which is incorrect.
Fix: wrap both occurrences in `escapeHtml(...)` (and prefer `escapeHtml(subject.grade ?? '—')`
and `escapeHtml(result.grade)`), then add a test asserting a grading-scale
label containing `<`/`>`/`"` renders escaped in both the per-subject row and
the total row.

### MEDIUM — `src/modules/exams/actions.ts` (`schedulePapers` / `exam.paper.schedule`)
Every SQL error from the `exam_papers` update/select calls goes through
`throwMapped(error)` with no raw-PostgREST-code check (unlike
`questionBank.create/update/archive` in `src/modules/question-bank/actions.ts`,
which have an explicit `isRlsViolation` check for `42501`). `mapSqlError`
(`src/lib/actions/result.ts`) only maps `code:<ErrorCode>` exception messages
from SQL functions, not raw Postgres codes — the packet's own "ErrorCode
mapping" ruling says raw codes "become `internal`" unless the action maps
them itself, and lists `42501 → forbidden`, `23514/23503/22P02 → validation_failed`
as the expected mapping for this action. Today a real RLS violation or a
check-constraint violation on this path (e.g. a race where a room/paper is
deleted between the pre-check and the update, or a future direct caller
without the current pre-checks) surfaces as a generic `internal` error
instead of `forbidden`/`validation_failed`. Not an authorization bypass
(RLS still blocks the write; the permission gate still blocks a teacher
before the handler runs) and fails safe (no data leak), but it is a spec
deviation that degrades error-message quality and isn't exercised by
`tests/db/exam-schedule-actions.test.ts` (all its negative cases are
pre-checked in code before any SQL error can occur, so the gap is untested).
Fix: add the same `isRlsViolation`-style 42501/23514/23503/22P02 mapping used
in `question-bank/actions.ts` to `schedulePapers`.

### LOW — `src/modules/question-bank/schemas.ts`
`QuestionCreateSchema` and `QuestionUpdateSchema` each inline an identical
~40-line `superRefine` body (MCQ options/answer rules, true/false answer
rule) instead of the packet's specified shared `questionRules` function
(`QuestionCreateSchema = base.strict().superRefine(questionRules)`). Pure
duplication of a security-relevant validation gate (the only server-side
check that MCQ answers stay inside the offered options and that non-MCQ
types carry no options) — functionally equivalent today, but a future edit
to one copy and not the other would silently diverge create vs. update
validation. The task-3 completion report calls this "DRY approach" despite
the duplication. No test currently diffs create/update validation parity.
Fix: extract `questionRules(data, ctx)` once and pass it to both `superRefine` calls.

## Verified clean (no issues found)

- **RLS (`supabase/migrations/20261028000073_question_bank_exam_schedule.sql`)**:
  `question_bank` SELECT/INSERT/UPDATE policies correctly use the initPlan
  `app.my_institution_ids(...)`/`app.my_taught_section_subjects()` helpers
  (no per-row `security definer` calls), table-qualify every
  `question_bank.*` column reference, bind `subject_id`/`grade_id`/
  `curriculum_unit_id` to the row's own `institution_id` (and the unit to the
  same subject+grade) on both INSERT and UPDATE `with check`, and the
  column grant correctly excludes `institution_id`/`created_by` from
  `authenticated`'s UPDATE grant (immutable). No DELETE policy, matching the
  "archive via `is_active=false`" ruling. `exam_papers_insert`/`_update` are
  correctly dropped and recreated with the room bound to the paper's own
  institution. No admin/admissions/accountant/guardian/student policy on
  `question_bank`, matching the "no admin" ruling.
- **`src/modules/question-bank/actions.ts` / `src/modules/exams/actions.ts`
  (`schedulePapers`)**: every row read/write is scoped with
  `.eq("institution_id", ctx.institution.id)` in addition to RLS (defense in
  depth); `schedulePapers` pre-validates the exam's institution and
  `published` state, every paper belongs to `input.examId`, and every room
  belongs to the caller's institution before issuing any write — correct FK/
  institution binding and state guard (exam `published` → `invalid_state`).
  Audit calls carry ids/counts only, never question text or marks.
- **`src/lib/http/html.ts` / route.ts `format=html` branch**: error results
  keep the JSON envelope untouched, `null` → 404, non-`{html}` → 422, and the
  200 response sets all five required headers (`content-type`,
  `cache-control: private, no-store`, `x-content-type-options: nosniff`, the
  strict CSP, `referrer-policy: no-referrer`). Permission/RLS checks happen
  inside `dispatchCall` before the format branch runs, so `?format=html`
  cannot bypass authorization.
- **Permissions (`src/lib/auth/permissions.ts`, `tests/unit/permissions.test.ts`,
  `docs/planning/coolskool/07-security-and-ai-governance.md`)**: `question.manage`
  granted to exactly owner/principal/exam_controller/teacher, matching the
  07 §2.2 row added and the ruling (no admin, no admissions/accountant/
  guardian/student).
- **`escapeHtml` itself** is a correct allow-list character map
  (`&<>"'`), and every other interpolated field in the report card
  (student name, exam name/type, admission no., remark, institution name,
  title) is escaped.
- **Test coverage**: all TEST FIRST scenarios in the packet for T2, T4, T5,
  T6, T7, T8, T10, T11 are present (institution-B subject/room rejection,
  teacher taught-vs-untaught scope, `created_by` immutability, published-exam
  guard, cross-exam paper rejection, guardian/student `[]`/`42501`,
  room-timetable clash, section double-booking, guardian-vs-other-family
  404 on the report card). The "module disabled → forbidden" T4 case is
  correctly skipped per this lane's controller ruling (MOD not merged yet).

## Outcomes (fix pass)

- **HIGH — `report-card-html.ts` grade escaping: fixed.** Wrapped both
  `subject.grade` (per-subject row) and `result.grade` (tfoot total row) in
  `escapeHtml(...)`, using `escapeHtml(subject.grade ?? '—')` for the
  nullable per-subject value. Added
  `tests/unit/report-card-html.test.ts` case "escapes a grading-scale label
  containing HTML in the per-subject row and the total row" (fails without
  the fix, passes with it). `pnpm test tests/unit/report-card-html.test.ts`
  → 18/18 pass.
- **MEDIUM — `exams/actions.ts` `schedulePapers` raw PG error mapping: fixed.**
  Added `throwMappedSchedule` (42501 → `forbidden` "Outside your teaching
  scope.", 23514/23503/22P02 → `validation_failed`, else falls through to the
  existing `throwMapped`/`mapSqlError`/`internal` path) and swapped it in for
  the exam select, paper select, room select, and per-paper update call sites
  inside `schedulePapers` only (other actions in the file untouched — not in
  scope). Added `tests/unit/exam-schedule-error-mapping.test.ts` (pure unit
  test against the exported mapping function, since every negative path
  reachable through the action today is pre-checked in code before any SQL
  error can occur — matches the finding's own note that the gap is a
  future/race-condition concern, not a reachable bug). `pnpm test
  tests/unit/exam-schedule-error-mapping.test.ts` → 5/5 pass; `pnpm test:db
  tests/db/exam-schedule-actions.test.ts` → 7/7 pass (no regression).
- **LOW — `question-bank/schemas.ts` duplicated `questionRules`: fixed.**
  Extracted the shared `questionRules(data, ctx)` superRefine body once;
  `QuestionCreateSchema = baseQuestionObject.strict().superRefine(questionRules)`
  and `QuestionUpdateSchema = baseQuestionObject.extend({ id: uuid }).strict().superRefine(questionRules)`
  per the packet's original ruling. Added a parity test
  (`QuestionCreateSchema vs QuestionUpdateSchema parity`,
  `tests/unit/question-bank-schemas.test.ts`) that diffs both schemas over
  six invalid variants to catch a future divergence. `pnpm test
  tests/unit/question-bank-schemas.test.ts` → 45/45 pass.

**Full milestone rerun after fixes:** `pnpm test:db tests/db/question-bank-rls.test.ts
tests/db/question-bank-actions.test.ts tests/db/question-bank-queries.test.ts
tests/db/exam-schedule-actions.test.ts tests/db/exam-schedule-queries.test.ts
tests/db/api-query-route.test.ts tests/db/question-bank-schedule-acceptance.test.ts`
→ 43/43 pass (7 files). `pnpm test tests/unit/question-bank-schemas.test.ts
tests/unit/exam-schedule-conflicts.test.ts tests/unit/permissions.test.ts
tests/unit/action-names-unique.test.ts tests/unit/html-response.test.ts
tests/unit/report-card-html.test.ts tests/unit/exam-schedule-error-mapping.test.ts`
→ 108/108 pass (7 files). `pnpm test:security tests/security/escalation.test.ts`
→ 902/902 pass (matches task-4's pre-fix baseline — no regression).
`pnpm lint` clean. `pnpm typecheck` clean.
