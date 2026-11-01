### Task 8: M04-T8 Acceptance + templates
READ: BRIEF-COMMON.md; Tasks 5–6 tests
FILES: `public/templates/students.csv`, `public/templates/staff.csv` (new: header row = `STUDENT_COLUMNS`/`STAFF_COLUMNS` + one example row); `tests/db/imports-acceptance.test.ts` (new)
TEST: generate a 200-student CSV (5 deliberately bad rows at known lines: bad phone, bad dob, unknown section, missing first_name, duplicate admission_no in file) over HTTP (`/api/v1/actions/data.import.stage` then `.commit`, bearer admin) → 195 committed, 5 reported with exact row numbers; commit again → same counts, students unchanged; `GET /api/v1/query/people.listStudents?format=csv` → CSV contains a committed admission_no. Template headers equal the schema column constants (read the files in the test).
ACCEPT: `pnpm test:db tests/db/imports-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T8: `11-operations.md` onboarding runbook (day 1 templates + import, day 2 structure + timetable + fees, day 3 invites + training + go-live); DBT-44 (fee/marks CSV deferred); `07 §4` note (commit is invoker, no definer); security review on the diff; full gate incl. `pnpm db:reset`-free reseed check (`seed-determinism`); commit/push; `DONE M04 <sha>`.
