# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M12-tasks.md
## Tasks
- 2026-11-04 wave1: T1 T2 T3 T6 T10 dispatched (Agent tool, no Workflow)
- T3 DONE (23 unit)
- T6 DONE (13 unit)
- T1 DONE (22 unit)
- T10 DONE (14 unit)
- T2 DONE (DBT-40 = read-path max_rows; 0082); T4 dispatched (exclusive), T5 queued
- T4 DONE (11 db, security 2212; grants.test.ts touched); T5 dispatched (exclusive); T7/T8/T9/M18-T2 queued
- T5 DONE (10 db, security 2221); T7 T8 T9 T11 T12 + M18-T2 dispatched
- T7 DONE (6 db)
- T12 DONE (8 db, 3 security; eslint.config.mjs override added — verify)
- T9 DONE (2 db — thin vs TEST FIRST list; reviewer to check coverage)
- T11 DONE (6 db, 6 unit)
- T8 DONE (7 db); T13 dispatched
- T13 DONE (5 acceptance); review + T14 docs + M18-T4 drill dispatched (fable)
- review: 0 CRIT, 1 HIGH (record_online_payment: captured money on since-paid invoice → 400, never booked), 3 MED (void key reuse ignores payment_id; createIntent orders before state check / no amount max; mapSqlError 42501/23505), 9 LOW; fix waits for M18-T4 drill to release DB
- T14 DONE (docs; DBT-66..69)
- MERGE NOTE: lane-b M15 docs used DBT-66..73, main M12 used DBT-66..69 → renumber M15 rows to DBT-70..77 at merge (and any code/doc refs e.g. DBT-73 in security-review)
- fix round DONE (92 db, unit 1509, security 2256; DBT-70..72); 0074/0082/0083 verified not hosted
