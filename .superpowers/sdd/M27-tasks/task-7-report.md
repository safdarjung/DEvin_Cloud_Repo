Packet: M27-T7 Perf on big new tables
Files changed: tests/db/fabric-perf.test.ts (new)
Behavior implemented: Exports `NEW_TABLES` (45 M12-M25/X01-X08 tables) and
`PERF_MATRIX` (table -> probes). Test 1 counts demo-tenant rows for all 45,
asserts every table >=10,000 rows is a `PERF_MATRIX` key. Test 2 times each
probe (1 warm-up + 3 timed calls, median): RLS count(*) as principal,
teacher.vi-a, student.one, guardian.one; registered queries via in-process
route+bearer (mastery.heatmapBySection, mastery.studentSuccessRows,
mastery.gapsForStudent self + guardian.one/Aarav). Asserts median < 1500ms.
Tests run: `pnpm test:db tests/db/fabric-perf.test.ts` -> 10/10 passed
(no reset/seed, read-only, harness DB restriction). Only mastery_snapshots
is big (44,164 rows); other 44 max 720 (ptm_slots). Medians (ms): count(*)
12.7-22.0; heatmapBySection 123.4 (principal)/34.5 (teacher); studentSuccess
Rows 64.0; gapsForStudent 17.8 (student.one)/14.1 (guardian.one). Worst 123ms.
`pnpm lint`/`tsc --noEmit` clean on the file.
Tests not run and why: `pnpm db:reset` skipped (harness DB restriction; ran
against the lane's already-seeded demo tenant instead, same counts T2/T3 report).
Limitations / honesty label: n/a (test file only).
Security / integration risks: none — read-only, no writes/schema change. No
budget miss, so no new migration debt.
Follow-ups: a future table crossing 10,000 demo rows fails test 1 until added
to PERF_MATRIX.
New dependencies (justification): none
Assumptions made: query probes use symbolic input keys ("none", "vi-a-section",
"self-student", "aarav") resolved to real seeded ids in beforeAll, since ids
are tenant-seed-dependent and can't be literals in the static matrix.
