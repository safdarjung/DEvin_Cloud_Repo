Packet: M20-T9 Queries mastery.studentSuccessRows, mastery.interventions

Files changed: `src/modules/mastery/queries.ts` (edit, +2 exports); `src/modules/mastery/query-defs.ts` (edit, +2 defineQuery); `tests/db/api-query-route.test.ts` (+2 smoke samples); `tests/db/mastery-success-queries.test.ts` (new, 5 tests).

Behavior implemented: `masteryStudentSuccessRows(ctx, classSectionId)` — fixed query count (enrolments+names, `mastery_student_stats` RPC, snapshots for gaps, current-term attendance via paged `attendance_records`, published-exam `results` for trend, `insight_actions` plans), all via the caller's own RLS; risk/flags/trend from `rules.ts` (T3); sorted support→watch→none then name. `masteryInterventions(ctx, {studentId?, classSectionId?, status?})` — RLS-scoped `insight_actions` kind='intervention', owner via `staff(full_name)` or "Unassigned", ordered review_date/id, limit 200. Both `mastery.review`, module `mastery`.

Tests run: `pnpm test:db tests/db/mastery-success-queries.test.ts tests/db/api-query-route.test.ts` → 12/12 pass; `pnpm test:db tests/db/mastery-queries.test.ts` (T8 regression) → 9/9 pass; `pnpm lint` → 0 errors (pre-existing warnings elsewhere only); `pnpm typecheck` → clean.

Tests not run and why: `pnpm test:security` — not my task file, not DB owner, single-file rule.

Limitations / honesty label: none new — `limited` badge lands with T15's UI pass.

Security / integration risks: none new; both are security-invoker/RLS reads, no definer bypass. Found + worked around (not a code change, test-only): `tests/helpers/roles.ts` never sets `staff.user_id`, so a teacher reading their own `staff(full_name)` embed (RLS's own-row clause) returns null — set it directly in my test via `update public.staff set user_id=...` (precedent: `tests/db/hr-queries.test.ts`).

Follow-ups: none new.

New dependencies: none.

Assumptions made: no partial T9 work existed in-tree at start (queries.ts/query-defs.ts held only T8's exports); "current term" for the attendance window = year's term containing today else latest started term else none (mirrors the T12 gap-detector ruling, reused since T9 has no term-window ruling of its own); other concurrent agents' files (`actions.ts`, `detector.ts`, `mastery.compute.ts`, migration 0093, `mastery-fixture.ts`) seen mid-edit in `git status` but not read or touched.
