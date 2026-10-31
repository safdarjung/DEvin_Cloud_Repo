# M02 — Query registry + dispatcher (D41)

Source: `07-master-plan-v1-v2.md` §2 D41, §3 M2. No migration. No new deps. Builds on M01 (`src/lib/http/api-envelope.ts`, `withBearerToken`, `src/app/api/v1/actions/**`).

Wire contract:

```
POST /api/v1/query/<name>   body/headers exactly as POST /api/v1/actions/<name>
GET  /api/v1/query/<name>?institution=<slug>&input=<url-encoded JSON>   (x-institution header also accepted)
GET  /api/v1/query          → { ok: true, data: [{ name, permission, inputSchema }] }   (signed-in only)
```

Query names are `<module>.<fn>` (e.g. `people.listStudents`). A query is read-only: no audit, no writes. RLS stays the only data filter; the permission is a gate, not a filter.

Order: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 (sequential; T8 is the only DB user).

---

### Task 1: M02-T1 defineQuery + query registry
READ: BRIEF-COMMON.md; `src/lib/actions/{define-action,registry}.ts`; `tests/unit/define-action.test.ts`
FILES: `src/lib/actions/define-action.ts` (edit); `src/lib/actions/define-query.ts` (new); `tests/unit/define-query.test.ts` (new)
EXPORTS: in define-action.ts move the guard body (ctx resolve incl. VITEST-gated `overrideCtx`, Zod parse, permission, handler, error mapping) into `export function guardedCall<I, O>(opts): Action<O>` with no registration; `defineAction` = `guardedCall` + `registerAction` (behaviour unchanged, all existing comments kept). define-query.ts: `defineQuery<I, O>(opts: { name; schema; permission; handler(input, ctx) })` = `guardedCall` + register in a module-private map; `getRegisteredQueries(): ReadonlyMap<string, AnyAction>`; `getQueryMeta(): ReadonlyMap<string, ActionMeta>` (reuse `ActionMeta`). First registration wins. Not a `"use server"` file.
TEST FIRST: "defineQuery returns ok(data) for a permitted ctx"; "missing permission → forbidden"; "bad input → validation_failed"; "query registers in getRegisteredQueries, not getRegisteredActions"; "meta records schema + static permission". Existing `define-action.test.ts` stays green untouched.
ACCEPT: `pnpm test tests/unit/define-query.test.ts tests/unit/define-action.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 2: M02-T2 Shared dispatch helper (refactor)
READ: BRIEF-COMMON.md; `src/app/api/v1/actions/[name]/route.ts`; `src/app/api/v1/actions/route.ts`
FILES: `src/lib/http/dispatch.ts` (new); `src/app/api/v1/actions/[name]/route.ts` (edit); `src/app/api/v1/actions/route.ts` (edit)
EXPORTS: move logic out of the two routes, unchanged in behaviour: `readPostBody(request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }>` (Origin check, 1 MB cap, 400/413) · `dispatchCall(request, name, registry: ReadonlyMap<string, AnyAction>, body: unknown): Promise<Response>` (body schema, slug from `x-institution` ?? body.institution, lookup → 404, `withBearerToken` when bearer present, control-flow digests → 401/404, else 500 with correlation id) · `listResponse(request, meta: ReadonlyMap<string, ActionMeta>): Promise<Response>` (the GET listing incl. 401). Routes become ≤ 15 lines each.
TEST FIRST: none new — this is a pure refactor; the safety net is the existing suites.
ACCEPT: `pnpm test:db tests/db/api-actions-route.test.ts` (8/8, unchanged file); `pnpm test tests/unit/api-actions-list.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 3: M02-T3 people + academics query defs, manifest, completeness test
READ: BRIEF-COMMON.md; `src/modules/people/queries.ts`; `src/modules/academics/assignments.queries.ts`; `tests/unit/action-names-unique.test.ts`; `src/lib/auth/permissions.ts`
FILES: `src/modules/people/query-defs.ts` (new); `src/modules/academics/query-defs.ts` (new); `src/app/api/v1/query/all-queries.ts` (new, side-effect imports, comment "every query-defs file must be imported here"); `tests/unit/action-names-unique.test.ts` (edit)
RULES FOR EVERY query-defs FILE (T3–T6): one `defineQuery` per exported async `(ctx, …)` function in the module's queries file; name `<module>.<fn>`; handler only adapts input → the existing fn's args (no new logic, no new SQL); Zod schema per input (`z.uuid()` for ids, `z.iso.date()` for dates, optional where the fn's param is optional, `z.object({})` when none). Permission = the key the calling page gates on (`grep -rn "<fn>(" src/app`); if the page gates on none, use the module read key: people `student.read`, academics `assignment.read`, attendance `attendance.read`, admissions `admissions.enquiry.read`, exams `exam.result.read`, finance `finance.read`, notifications `notification.read`, jobs `job.manage`, ai `ai.usage.read`, website `website.edit`, core `dashboard.view`. The key must be held by every role whose page calls the fn (check `permissions.ts`); guardian/student portal fns must use a key those roles hold. Skip pure helpers (no I/O) and anything already internal-only (teacher-scope, listGuardianChildren); list skips with reason in the report.
EXPORTS (this task): people → `people.listStudents {query?, page}`, `people.getStudentProfile {studentId}`, `people.getCurrentTermId {academicYearId}`, `people.listMyChildren {}`, `people.getMyStudent {}`; academics → `academics.listTeacherAssignments`, `academics.getAssignment {assignmentId}`, `academics.listStudentAssignments {studentId}`, `academics.listCurriculumUnits {…as fn}`, `academics.listTeachableSections`, `academics.listSectionSubjects {classSectionId}`.
TEST FIRST: new `it` "every defineQuery name is registered after importing the query manifest" (mirror the actions case: static regex over `defineQuery(` vs `getRegisteredQueries()` after importing `@/app/api/v1/query/all-queries`), plus extend the uniqueness check to query names. Prove RED by omitting an import.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 4: M02-T4 attendance + admissions + core query defs
READ: BRIEF-COMMON.md; Task 3 rules (in this file); `src/modules/{attendance,admissions}/queries.ts`; `src/modules/core/dashboard.queries.ts`
FILES: `src/modules/attendance/query-defs.ts` (new); `src/modules/admissions/query-defs.ts` (new); `src/modules/core/query-defs.ts` (new) — and one import line each in `all-queries.ts` (allowed 4th file, 3 lines)
EXPORTS: every exported async ctx fn per Task 3 rules (`getSectionAttendancePatterns` included, name `attendance.getSectionAttendancePatterns`); core → `core.getDashboardData {}`.
TEST FIRST: the T3 completeness test must go RED before the imports are added, GREEN after.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: M02-T5 exams + finance query defs
READ: BRIEF-COMMON.md; Task 3 rules; `src/modules/{exams,finance}/queries.ts`
FILES: `src/modules/exams/query-defs.ts` (new); `src/modules/finance/query-defs.ts` (new); `all-queries.ts` (2 import lines)
EXPORTS: every exported async ctx fn per Task 3 rules. Finance `listDefaulters`/`termCollectionSummary` take `{ termId }`. Money stays integer paise as returned.
TEST FIRST: completeness RED → GREEN as T4.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 6: M02-T6 notifications + jobs + ai + website query defs
READ: BRIEF-COMMON.md; Task 3 rules; `src/modules/{notifications,jobs,ai,website}/queries.ts`
FILES: `src/modules/{notifications,jobs,ai,website}/query-defs.ts` (4 new, each ≤ 40 lines); `all-queries.ts` (4 lines)
EXPORTS: tenant (ctx) fns only. Website public fns (`getPublicSite`, `getPublicPage`, `listPublicNotices`, `listPublicEvents`) are skipped — the public site has its own anon path.
TEST FIRST: completeness RED → GREEN as T4.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 7: M02-T7 Query routes
READ: BRIEF-COMMON.md; `src/lib/http/dispatch.ts`; `src/app/api/v1/actions/**/route.ts`
FILES: `src/app/api/v1/query/[name]/route.ts` (new: POST = `readPostBody` + `dispatchCall(…, getRegisteredQueries(), body)`; GET = body built from `institution`/`input` search params, bad `input` JSON → 400, no Origin check needed on GET); `src/app/api/v1/query/route.ts` (new: `listResponse(request, getQueryMeta())`); `tests/unit/api-query-list.test.ts` (new, mirror `api-actions-list.test.ts`)
TEST FIRST: listing 401 without claims; listing contains `people.listStudents` with `permission: "student.read"` (or whatever T3 recorded) and every registered query serialises.
ACCEPT: `pnpm test tests/unit/api-query-list.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 8: M02-T8 Query API db test (RLS still the filter)
READ: BRIEF-COMMON.md; `tests/db/api-actions-route.test.ts` (mirror fixtures/tokens); `tests/helpers/{roles,actions}.ts`
FILES: `tests/db/api-query-route.test.ts` (new)
TEST: call the real GET/POST handlers with bearer tokens on a fixture institution: guardian `people.listMyChildren` → 200, only own child; guardian `people.getStudentProfile` for another student → 200 with `data: null` (RLS hides, no leak); guardian `jobs.listAttentionJobs` → 403 (guardian lacks `job.manage`); teacher `people.listStudents` via GET with url-encoded input → 200; no token → 401; unknown query → 404; smoke: owner calls every registered query with a sample input (uuid placeholders) → none returns `internal` (prints failing names).
ACCEPT: `pnpm test:db tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T8: security-reviewer pass on the M02 diff; full gate (plan §4.6); FB-CORE-10 row; commit/push; `DONE M02 <sha>`.
