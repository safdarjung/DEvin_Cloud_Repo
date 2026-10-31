# T-022 — Assignments module (create, publish, views)

| Field | Value |
|---|---|
| Lane / Day | D / Day 9 |
| Size | 1 agent-day |
| Critical path | no (T-036 and T-034 depend on it) |
| Review | code-reviewer |
| Feature ids | F-ACA-04, F-ACA-05 |
| Depends on | T-011, T-007, T-013 (merged) |
| Migration | — |

## Business outcome
Teachers create and publish assignments (plain or quiz content) for the sections they teach; guardians and students see published ones. This is the save target for AI-generated quizzes.

## Current repo state (verify before starting)
- Tables: `grep -n "create table public.assignments\|curriculum_units" supabase/migrations/20261028000005_academics.sql`.
- `app.teaches_section` helper: `grep -n "teaches_section" supabase/migrations/20261028000001_foundation.sql`.
- Academics queries exist (lead-owned): `ls src/modules/academics/queries.ts`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W6` (Create and Review/save only) · `05-data-architecture.md §2.3` (`curriculum_units`, `assignments`) · `07 §2` (`assignment.manage`, `assignment.read`) · `09 §3` (Lane D owns `src/modules/academics/**/assignments*`).

## Files to inspect first
`src/modules/academics/queries.ts` (do not duplicate section/subject reads) · `src/modules/attendance/components/*` (teacher page conventions) · `src/lib/actions/define-action.ts`.

## Expected changes
- `src/modules/academics/assignments.schemas.ts` — `CreateAssignmentSchema` (`classSectionId`, `subjectId`, `curriculumUnitId?`, `title`, `instructions?`, `dueAt?`, `content?: QuizContent`, `aiGenerated?`), `PublishAssignmentSchema`, `QuizContentSchema` (questions with `stem`, `options[4]`, `answer`, `explanation?`).
- `src/modules/academics/assignments.actions.ts` — `createAssignment` (draft), `updateAssignment` (draft only), `publishAssignment` (→ `published`, audit `assignment.published`).
- `src/modules/academics/assignments.queries.ts` — `listTeacherAssignments(ctx)`, `getAssignment`, `listStudentAssignments(studentId)` (published only), `listCurriculumUnits({ gradeId, subjectId })`.
- `src/modules/academics/components/{AssignmentForm,AssignmentList,QuizContentView,StudentAssignments}.tsx` — `StudentAssignments` exported for the portal.
- `src/app/(tenant)/[institution]/assignments/{page,new/page,[id]/page}.tsx`.
- `tests/unit/assignment-schemas.test.ts`, `tests/db/assignments.test.ts`.

## Must not modify
`src/modules/academics/queries.ts`, `schemas.ts`, `actions.ts` (lead-owned; add new `assignments.*` files instead) · migrations · `src/lib/nav.ts` (request).

## Permissions / nav / migration numbers needed from the lead
Nav: `{ href: '/assignments', label: 'Assignments', permission: 'assignment.read' }`.

## Security and data-integrity requirements
- `assignment.manage` plus a server-side check that `ctx.membership.staff_id` teaches the section (`subject_assignments` or class teacher); admins/principal bypass per matrix.
- `updateAssignment` refuses non-draft; `content` validated by `QuizContentSchema` with `.strict()` (max 30 questions, 4 unique options, answer ∈ options).
- Guardian/student reads rely on RLS plus `status = 'published'` filter in the query.

## Acceptance criteria
1. `teacher.vi-a` creates a draft for VI-A Mathematics, publishes it; it appears for `guardian.one` (child in VI-A) and not for `guardian.two`.
2. `teacher.viii-b` gets `forbidden` creating for VI-A.
3. Quiz content renders read-only with answers hidden for guardians/students, visible for the teacher.
4. Editing a published assignment returns `invalid_state`.

## Tests (write failing tests first) and exact commands
- `tests/unit/assignment-schemas.test.ts` → `pnpm test -- tests/unit/assignment-schemas.test.ts`
- `tests/db/assignments.test.ts` (scope, state guard, published-only reads) → `pnpm test:db -- tests/db/assignments.test.ts`

## Deliverables
Three new module files, four components, three pages, tests, nav request.

## Assumptions and risks
- Submissions (F-ACA-06) are out of scope; the detail page says "Submissions: planned" (label).
- `QuizContentSchema` must stay identical to the schema T-036 uses — T-036 imports it from here.

## Completion report
Use the format in `CLAUDE.md`.
