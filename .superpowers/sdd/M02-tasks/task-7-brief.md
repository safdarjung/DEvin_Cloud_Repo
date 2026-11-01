### Task 7: M02-T7 Query routes
READ: BRIEF-COMMON.md; `src/lib/http/dispatch.ts`; `src/app/api/v1/actions/**/route.ts`
FILES: `src/app/api/v1/query/[name]/route.ts` (new: POST = `readPostBody` + `dispatchCall(…, getRegisteredQueries(), body)`; GET = body built from `institution`/`input` search params, bad `input` JSON → 400, no Origin check needed on GET); `src/app/api/v1/query/route.ts` (new: `listResponse(request, getQueryMeta())`); `tests/unit/api-query-list.test.ts` (new, mirror `api-actions-list.test.ts`)
TEST FIRST: listing 401 without claims; listing contains `people.listStudents` with `permission: "student.read"` (or whatever T3 recorded) and every registered query serialises.
ACCEPT: `pnpm test tests/unit/api-query-list.test.ts`; `pnpm lint`; `pnpm typecheck`

