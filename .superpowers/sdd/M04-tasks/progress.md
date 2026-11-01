# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M04-tasks.md
Spec: 07-master-plan §3 M4. M01–M03 rulings carry over. Plan-level rulings are in the task file header (scope students+staff, DBT-44 deferral, data.import only, invoker commit, idempotency keys).
## Pre-flight
| Pair | Interface | Finding |
|---|---|---|
| T2→T3 | same migration file, unpushed | T3 appends; local re-apply via create or replace |
| T4→T5,T6,T7,T8 | schemas, parseCsv, column constants, papaparse | ok |
| T3→T6 | commit_import_batch jsonb | ok |
| T5,T6 | escalation fixtures + manifest lines | in cards (M03 lesson) |
## Tasks
Task 1: complete (commits ..251d9cb, review clean)
Ruling: T2+T3 batched (one migration file).
Tasks 2,3: complete (commits ..41579d2). Agent added 3 app.* definer helpers (lock, audit, guardian link — DBT-45 recursion workaround). Controller fix: lock_import_batch had no role check → added.
Task 4: complete (commits ..7c03e8d, review clean; header-set check pushed to T5)
Ruling: T5+T6 batched (same actions file).
Tasks 5,6: complete (commits ..21d7845); agent resumed once after rate limit. LOW parked: rowNo=index+2 drifts with blank lines/multiline cells (skipEmptyLines).
Ruling: T7+T8 batched (T8 uses T7's ?format=csv).
Tasks 7,8: complete (commits ..2a6eb17); controller: CSV injection prefix + tab/CR. Note: paginated queries (people.listStudents) export one page only — full export is M15 report.export.
Security review (Sonnet): 0 CRIT, 0 HIGH, 1 MED, 4 LOW. Controller fixed MED: commit_import_batch rejects batch whose row_count ≠ rows (partial stage) → invalid_state, + test. LOW parked: admin can PATCH import_batches status directly (own institution bookkeeping only); MAX_CSV_BYTES shadowed by dispatcher 1 MB cap; raw PG errors in server logs; GET csv no Origin check (read-only).
Gate run 1: 7 db fails — imports-commit fixtures (row_count, from the MED fix), query smoke missing imports.getBatch sample, invoice-generation chunk test flaky under load (passed on rerun). Fixed; rerun: unit 956, db 452, security 1276 green.
M04 DONE 849a305 pushed
