# Task 8 report — M02-T8 Query API db test

File: `tests/db/api-query-route.test.ts` (new, 7 tests)

## What it proves

Calls the real exported `GET`/`POST` of `src/app/api/v1/query/[name]/route.ts`
with real bearer tokens (`clientAs(role).auth.getSession()`), mirroring
`tests/db/api-actions-route.test.ts`. `@/lib/supabase/server` is not mocked —
real RLS under `withBearerToken` is what's under test.

1. `guardian: people.listMyChildren -> 200, only own (portal_access) child` —
   two students linked to the guardian, one `portal_access: true` (visible),
   one `false` (hidden). Response has only the visible one.
2. `guardian: people.getStudentProfile for another (unlinked) student -> 200,
   data: null` — second student in the same institution, no
   `guardian_students` row at all. `students_select` RLS
   (`20261028000025_staff_read_scope.sql`) excludes it from
   `app.my_student_ids()`, so the handler's `.maybeSingle()` sees no row
   and returns `null` — no error, no leak.
3. `guardian: jobs.listAttentionJobs -> 403 forbidden` — guardian role lacks
   `job.manage` (`src/lib/auth/permissions.ts` guardian list).
4. `teacher: people.listStudents via GET with url-encoded input -> 200` —
   `?institution=&input=<url-encoded JSON>` path.
5. `no token -> 401 unauthenticated`.
6. `unknown query -> 404 not_found`.
7. `owner smoke: every registered query runs, none returns internal` —
   builds a sample-input map (uuid placeholder
   `00000000-0000-4000-8000-000000000000`, date `2026-10-01`) for all 68
   registered queries (`getRegisteredQueries()`), calls each as owner,
   fails the test only if any returns `error.code === "internal"` or is
   missing from the map. Prints failing names via `expect(failing).toEqual([])`.

## Result

No bugs found: all 68 queries returned `ok`/`not_found`/`validation_failed`
(none `internal`) on first run. No `it.fails`/skip needed.

## Tests run

`pnpm test:db tests/db/api-query-route.test.ts` → **7 passed (7)**, first run,
no DB reset/seed (only DB user this session).

`pnpm lint` → clean.
`pnpm typecheck` → clean.

## Limitations / honesty label

N/A — read-only API test, no UI, no simulated/limited surface.

## Security / integration risks

None found. RLS confirmed as the actual filter for `getStudentProfile`
(cross-guardian leak test) and `listMyChildren` (`portal_access` scoping).
Permission gate confirmed for `jobs.listAttentionJobs` (guardian 403).

## Follow-ups

None.

## New dependencies

None.

## Assumptions made

- "Another student" for `getStudentProfile` read as same-institution,
  unlinked (not cross-institution) — this is what actually exercises the
  `students_select` RLS policy's guardian branch (the app code itself
  already filters by `ctx.institution.id`, so a cross-institution id would
  only prove the app-level filter, not RLS).
- Sample-input map for the smoke test is hand-built from each query-defs
  file's Zod schema (read directly), not derived programmatically — matches
  brief's "build the sample-input map from each query's schema shape."
