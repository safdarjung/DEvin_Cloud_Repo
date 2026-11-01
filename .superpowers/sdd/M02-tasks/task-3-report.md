# M02-T3 report — people + academics query defs, manifest, completeness test

## Files changed
- `src/modules/people/query-defs.ts` (new)
- `src/modules/academics/query-defs.ts` (new)
- `src/app/api/v1/query/all-queries.ts` (new)
- `tests/unit/action-names-unique.test.ts` (edit — added `Query names (M02)` describe block, mirroring the actions C-03 checks for the separate query registry)

## TDD
- RED: added the two new `it`s (literal-name-uniqueness over `defineQuery(`, and registration-after-import against `getRegisteredQueries()`) before either query-defs file or the manifest existed.
  - `pnpm test tests/unit/action-names-unique.test.ts` → 2 failed / 2 passed: `expected 0 to be greater than 0` (no `defineQuery(` calls yet) and `Cannot find package '@/app/api/v1/query/all-queries'`.
- GREEN: created both `query-defs.ts` files + `all-queries.ts`, re-ran → 4 passed.

## Permission table

| Query name | Permission | Why (file:line) |
|---|---|---|
| `people.listStudents` | `student.read` | `src/app/(tenant)/[institution]/students/page.tsx:29` — `requirePermission(ctx, "student.read")`. Module default (brief) also points here. |
| `people.getStudentProfile` | `student.read` | `src/app/(tenant)/[institution]/students/[studentId]/page.tsx:15`. Also reached via portal (`portal/layout.tsx:22`, same key). |
| `people.getCurrentTermId` | `student.read` | 4 call sites with 3 different page gates (`students/[studentId]/page.tsx:15` → `student.read`; `portal/page.tsx` → `student.read` via layout; `attendance/[sectionId]/page.tsx:20` → `attendance.mark`; `portal/attendance/page.tsx:19` → `attendance.read`). Two of the four gate on nothing stricter than `student.read`, and `student.read` is the only key every role reaching any of the four pages is guaranteed to hold (07 §2.2: all 9 roles hold `student.read`; `attendance.mark`/`attendance.read` are not held by `admissions`/`accountant`, who can still reach the `student.read`-only pages). |
| `people.listMyChildren` | `student.read` | `src/app/(tenant)/[institution]/portal/layout.tsx:22` — the only gate on the whole portal shell both this and `getMyStudent` are called from. |
| `people.getMyStudent` | `student.read` | same as above. |
| `academics.listTeacherAssignments` | `assignment.read` | `src/app/(tenant)/[institution]/assignments/page.tsx:21`; also gated the same way at `.../today/page.tsx:63` (`canReadAssignments`). |
| `academics.getAssignment` | `assignment.read` | `src/app/(tenant)/[institution]/assignments/[id]/page.tsx:20`. |
| `academics.listStudentAssignments` | `assignment.read` | `assignments/page.tsx:21` (staff) and `portal/assignments/page.tsx:18` / `portal/page.tsx:78` (guardian/student) all gate on `assignment.read`; held by every role (`owner/principal/admin/teacher/student/guardian`) that reaches any of these pages. |
| `academics.listCurriculumUnits` | `assignment.read` | No page or action calls this fn today (grepped `listCurriculumUnits(` across `src/app` + `src/modules` — only its own export in `assignments.queries.ts`). Used the brief's module default (`academics` → `assignment.read`) verbatim since the page gates on none. |
| `academics.listTeachableSections` | `ai.generate` | 3 call sites, 2 distinct gates: `ai/page.tsx:22` and `assignments/units/[unitId]/page.tsx:18` both gate `ai.generate`; `assignments/new/page.tsx:15` gates `assignment.manage`. Neither the module default (`assignment.read`) nor `assignment.manage` is held by every caller — `admissions` reaches this fn via `ai/page.tsx`'s `ai.generate` gate but has neither `assignment.read` nor `assignment.manage` (07 §2.2). `ai.generate` *is* held by every role that can reach any of the 3 pages (`owner/principal/admin/admissions/teacher`; `assignment.manage`'s holders — `owner/principal/teacher` — are a subset), and it's an actual gate on 2 of the 3 call sites, so it was chosen over introducing an unused key like `academics.read`. |
| `academics.listSectionSubjects` | `ai.generate` | Same 3 call sites as `listTeachableSections` (`assignments/new` and `assignments/units` both call it right after `listTeachableSections`); identical reasoning. |

## Skipped functions

| Function | Reason |
|---|---|
| `listGuardianChildren` (academics) | Named explicitly in the brief as already internal-only — returns a guardian's own child ids for `assignments/page.tsx`'s internal use, not a standalone page-gated read. |
| `escapeIlike`, `quoteOrValue` (people), `toSummary`, `toChildSummary`, `parseStoredContent`, `parseAnswerKey`, `allSubjects` (academics, nested closure) | Pure helpers / internal row-shape mappers, no exported `(ctx, …)` I/O signature — not in scope per the brief's "one `defineQuery` per exported async `(ctx, …)` function" rule. |

## Tests run
- `pnpm test tests/unit/action-names-unique.test.ts` → RED (2/4 failing) then GREEN (4/4 passing). Full output captured above.
- `pnpm lint` → clean, no output (0 problems).
- `pnpm typecheck` → `next typegen && tsc --noEmit` → "Types generated successfully", no errors.

## Tests not run and why
- `pnpm test` (full unit suite), `pnpm test:db`, `pnpm test:security`, `pnpm test:e2e` — out of scope per packet (unit only, no DB; BRIEF-COMMON says run only the packet's test file while working, lead runs full suite at checkpoints).

## Limitations / honesty label
- No UI/HTTP route change in this task (that's a later M02 task per the task numbering — this task only builds the query-defs + manifest + completeness test). No honesty-badge surface touched.
- `academics.listCurriculumUnits` is wired per the brief's literal spec even though no current caller exists in the app — it will start being reachable at `/api/v1/query/academics.listCurriculumUnits` once the HTTP dispatcher for this route lands, gated by `assignment.read` (module default).

## Security / integration risks
- `ai.generate` as the permission for `listTeachableSections`/`listSectionSubjects` is a deliberate choice to satisfy "every calling role must hold it" given 3 pages gate inconsistently today (2x `ai.generate`, 1x `assignment.manage`) and no single existing permission from the `academics` module covers the `admissions` role's path through `ai/page.tsx`. If a future `admin`-without-`ai.generate` role split ever happens, this permission would need revisiting — flagging for reviewer attention since it's not a 1:1 mirror of either page's gate.
- RLS remains the real data filter in every handler (unchanged — handlers only forward to the existing `queries.ts`/`assignments.queries.ts` functions, no new SQL).

## Follow-ups
- None raised beyond the `ai.generate` note above; no new `12-decision-log.md` §Debt entries added (not asked, and no debt incurred beyond the documented judgment call).

## New dependencies (justification)
- none

## Assumptions made
- `listCurriculumUnits`'s input schema uses `gradeId`/`subjectId` (matching the existing `filter: { gradeId, subjectId }` param shape) rather than a flat two-arg call, since the fn takes one filter object.
- Reused the existing `uuid` helper from `src/lib/schemas/common.ts` (`z.string().uuid()`) rather than the brief's literal `z.uuid()` snippet — same validation, matches existing codebase convention (karpathy guidelines: reuse before writing new), and all ids used here are uuids so `z.iso.date()` was never needed.
- Query names use the exact `<module>.<fn>` spelling given in the brief's EXPORTS line.
