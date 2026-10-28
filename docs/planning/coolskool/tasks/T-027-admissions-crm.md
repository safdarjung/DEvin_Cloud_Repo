# T-027 — Admissions CRM: pipeline, convert, decisions

| Field | Value |
|---|---|
| Lane / Day | B / Day 9–10 |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-ADM-01, F-ADM-02, F-ADM-06 |
| Depends on | T-026, T-013 (merged) |
| Migration | — |

## Business outcome
The admissions officer sees every lead by stage, works it with notes and assignment, converts it into an application, and records offer/accept/reject decisions — demo steps 3 and 4.

## Current repo state (verify before starting)
- Admissions tables exist: `grep -n "enquiries\|applications" src/lib/db/types.ts | head -4`.
- Seeded grades, academic year, staff exist: `pnpm db:reset`; `select count(*) from grades` = 12.
- `defineAction`, nav, `audit` exist: `ls src/lib/actions/define-action.ts src/lib/nav.ts src/lib/audit.ts`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W4` (pipeline, decision; not enrolment), `§1`, `§4` · `05-data-architecture.md §2.5`, `§4.1` (admissions.stages) · `07 §2` (admissions.*) · `08 §4 J-03, J-04` · `08 §2` (state machines row).

## Files to inspect first
`src/modules/attendance/actions.ts` (action pattern) · `src/modules/core/schemas.ts` (settings type for stages) · `src/modules/academics/queries.ts` (grades list).

## Expected changes
- `src/modules/admissions/state.ts` — pure transition tables for enquiry stages (from settings order; backwards allowed except from `converted`) and application states per `06 §W4` diagram; `canTransition(from, to)`.
- `src/modules/admissions/schemas.ts` — `UpdateEnquiryStatusSchema`, `AddEnquiryNoteSchema`, `AssignEnquirySchema`, `ConvertEnquirySchema` (applicant, guardian, gradeId, academicYearId), `DecideApplicationSchema`.
- `src/modules/admissions/actions.ts` — `updateEnquiryStatus`, `addEnquiryNote`, `assignEnquiry` (`admissions.enquiry.write`), `convertEnquiryToApplication`, `decideApplication` (`admissions.application.decide`; inserts `application_decisions`, updates status; invalid → `invalid_state`); audit `admissions.enquiry.status`, `admissions.decision`.
- `src/modules/admissions/queries.ts` — `listEnquiriesByStage`, `getEnquiry`, `listApplications(status?)`, `getApplication`, `getAdmissionsFunnelCounts(academicYearId)` (exported for T-039).
- `src/modules/admissions/components/` — `PipelineBoard` (columns per stage, move via select — no drag dependency), `EnquiryDetail` (notes timeline, assign, convert button), `ApplicationDetail` (decision buttons with confirm), `DecisionTimeline`.
- Pages: `.../admissions/page.tsx`, `.../admissions/enquiries/[id]/page.tsx`, `.../admissions/applications/page.tsx`, `.../admissions/applications/[id]/page.tsx`.
- `src/lib/nav.ts` — one line for `/admissions` (guard `admissions.enquiry.read`).
- Tests: `tests/unit/admissions-state.test.ts`, `tests/db/admissions-actions.test.ts`, `e2e/j03-pipeline.spec.ts`, `e2e/j04-decision.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/modules/people/**` · `src/modules/finance/**` · enrolment action (T-028).

## Permissions / nav / migration numbers needed from the lead
Nav line for `/admissions`. Permissions exist.

## Security and data-integrity requirements
- Every action resolves the institution from the route slug; ids in input are verified to belong to `ctx.institution.id` (RLS makes foreign rows invisible; the action returns `not_found`).
- `decideApplication` by `admin` role → `forbidden` (matrix: only owner/principal/admissions).
- Notes are stored in `enquiries.notes` as an append-only JSON array with author and timestamp (no edit/delete in UI).

## Acceptance criteria
1. Board shows seeded enquiries grouped by the six stages; moving `new → contacted → visit_scheduled` updates the row and writes audit rows.
2. Converting an enquiry creates an application with a number `APP/2026/…`, sets enquiry `converted`; converting again → `invalid_state`.
3. `offer → accept` works; `submitted → accepted` directly → `invalid_state`; `reject` writes a decision row.
4. `getAdmissionsFunnelCounts` returns counts per stage and per application state matching SQL counts.
5. J-03 and J-04 pass.

## Tests (write failing tests first) and exact commands
- `pnpm test -- tests/unit/admissions-state.test.ts` · `pnpm test:db -- tests/db/admissions-actions.test.ts` · `pnpm test:e2e -- e2e/j03-pipeline.spec.ts e2e/j04-decision.spec.ts`

## Deliverables
State module, schemas, actions, queries, components, pages, nav line, tests, completion report.

## Assumptions and risks
- Seeded leads arrive with T-029 (Day 12); until then the E2E creates its own enquiry through the public form (T-024).
- The enrol button on an `accepted` application is rendered here as a placeholder that T-028 replaces.

## Completion report
Use the format in `CLAUDE.md`.
