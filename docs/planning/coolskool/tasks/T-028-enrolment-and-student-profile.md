# T-028 — Enrolment action + UI + student profile page

| Field | Value |
|---|---|
| Lane / Day | B / Day 11–12 |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-ADM-03, F-STU-01, F-STU-02, F-STU-04, F-STU-06 |
| Depends on | T-027, T-030, T-031 (merged) |
| Migration | — |

## Business outcome
One click turns an accepted application into an enrolled student with a linked guardian, a section seat, a fee assignment and a first invoice — and the student's profile page shows all of it. Demo step 5.

## Current repo state (verify before starting)
- `app.enrol_applicant` exists and C-20..C-23 pass at SQL level: `grep -n "enrol_applicant" supabase/migrations/20261028000008_finance.sql tests/db/finance-schema.test.ts`.
- Fee structures seeded or creatable: `select count(*) from fee_structures` > 0 after `pnpm db:reset` (T-033 may not be merged; T-031 provides the action to create one).
- Attendance summary and results components exist: `ls src/modules/attendance/components/StudentAttendanceSummary.tsx src/modules/exams/components/ReportCard.tsx` (ReportCard may be absent until T-019; render conditionally).

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W4` (enrolment steps, idempotency), `§1` · `05-data-architecture.md §2.2`, `§2.3` (enrolments) · `07 §2` (admissions.enrol, student.read) · `08 §3 C-20..C-23`, `§4 J-05, J-07` (profile parts).

## Files to inspect first
`supabase/migrations/20261028000008_finance.sql` (exact `app.enrol_applicant` signature and return shape) · `src/modules/admissions/components/ApplicationDetail.tsx` (placeholder to replace) · `src/modules/finance/queries.ts` (`listInvoicesForStudent`) · `src/modules/academics/queries.ts` (sections with capacity and active counts).

## Expected changes
- `src/modules/admissions/schemas.ts` — `EnrolApplicantSchema` (`applicationId`, `classSectionId`, `feeStructureId`, `rollNo?`).
- `src/modules/admissions/actions.ts` — `enrolApplicant` (`admissions.enrol`) → `app.enrol_applicant`; maps `code:conflict` (capacity), `code:invalid_state`; returns `{ studentId, admissionNo, invoiceId, alreadyEnrolled }`; `revalidatePath` for admissions and students.
- `src/modules/admissions/components/EnrolDialog.tsx` — section select showing `active/capacity`, fee structure select (default for the grade), optional roll no, success state with links.
- `src/modules/people/queries.ts` — `getStudentProfile(studentId)` (student, guardians via `guardian_students`, current enrolment, status).
- `src/modules/people/components/StudentProfile.tsx`, `StudentProfileHeader.tsx`, `GuardiansCard.tsx` — compose `StudentAttendanceSummary`, finance `StudentInvoices` (from T-032 if merged, else invoice list via `finance/queries.ts`), `ReportCard` list (if T-019 merged).
- Pages: `.../students/page.tsx` (search by name/admission no, paginated), `.../students/[studentId]/page.tsx`.
- `src/lib/nav.ts` — one line for `/students` (guard `student.read`).
- Tests: `tests/db/enrol-action.test.ts`, `e2e/j05-enrol.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/modules/finance/actions.ts` · `src/modules/academics/**` (reads only).

## Permissions / nav / migration numbers needed from the lead
Nav line for `/students`. Permissions exist.

## Security and data-integrity requirements
- The action passes only ids; all creation happens inside `app.enrol_applicant` (single transaction, row lock on the application).
- Double submit from the dialog must be safe: button disabled while pending, and the function's idempotency (`source_application_id`) covers retries (C-20).
- Student profile for a guardian is served only through the portal (T-034); the `/students` pages require `student.read` with staff role; guardians get `forbidden`.
- Search is paginated (`limit 50`) and never unbounded.

## Acceptance criteria
1. Enrolling an `accepted` seeded application yields admission no `ADM/2026/…`, a guardian matched by phone when one exists (C-21), an `enrolments` row with roll no, a `fee_assignments` row, and an invoice for the current term; application → `enrolled`.
2. Clicking enrol twice (or calling the action twice) returns `alreadyEnrolled: true` with the same ids (C-20).
3. Choosing a full section → `conflict` with a readable message (C-22); enrolling from `offered` → `invalid_state` (C-23).
4. `/students/[id]` shows guardians, section, invoice total/paid, attendance %, and report cards when results exist; `/students?q=ADM/2026/00001` finds the student.
5. J-05 passes.

## Demo-data contract and limitation
- J-05 enrols `APP-live-1` into I-C (new guardian) and `APP-live-2` into VI-B (guardian `9800000002` reused; `guardian.two` then shows two children in the portal).
- No guardian login is provisioned by enrolment (DBT-12); the profile shows "Portal login: not yet invited" with `<LimitedBadge />`.
- The Term 2 invoice is a full-term invoice (DBT-13), labelled "full term" on the profile.

## Tests (write failing tests first) and exact commands
- `pnpm test:db -- tests/db/enrol-action.test.ts` · `pnpm test:e2e -- e2e/j05-enrol.spec.ts`

## Deliverables
Schema, action, dialog, profile queries/components, pages, nav line, tests, completion report.

## Assumptions and risks
- Guardian portal login for the newly created guardian is not created at enrolment (no `user_id`); labeled "portal invite: planned" on the profile.
- If T-032's `StudentInvoices` is not merged yet, render a minimal table from `finance/queries.ts` and note it.

## Completion report
Use the format in `CLAUDE.md`.
