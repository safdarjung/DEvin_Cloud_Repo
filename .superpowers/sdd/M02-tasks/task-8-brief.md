### Task 8: M02-T8 Query API db test (RLS still the filter)
READ: BRIEF-COMMON.md; `tests/db/api-actions-route.test.ts` (mirror fixtures/tokens); `tests/helpers/{roles,actions}.ts`
FILES: `tests/db/api-query-route.test.ts` (new)
TEST: call the real GET/POST handlers with bearer tokens on a fixture institution: guardian `people.listMyChildren` → 200, only own child; guardian `people.getStudentProfile` for another student → 200 with `data: null` (RLS hides, no leak); guardian `jobs.listAttentionJobs` → 403 (guardian lacks `job.manage`); teacher `people.listStudents` via GET with url-encoded input → 200; no token → 401; unknown query → 404; smoke: owner calls every registered query with a sample input (uuid placeholders) → none returns `internal` (prints failing names).
ACCEPT: `pnpm test:db tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T8: security-reviewer pass on the M02 diff; full gate (plan §4.6); FB-CORE-10 row; commit/push; `DONE M02 <sha>`.
