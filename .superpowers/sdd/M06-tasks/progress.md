# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M06-tasks.md
Spec: 07-master-plan §3 M6. Earlier rulings carry over. Plan rulings in task-file header (no audit RPC; managers-only announcements table; publish definer RPC; preferences in createNotification).
Routing (owner 2026-11-01): T1 inline; T4 Haiku; T2/T3/T5/T6 Sonnet. Parallel: T2 ‖ T4, then T3 ‖ T5, then T6.
## Pre-flight
| Pair | Interface | Finding |
|---|---|---|
| T2→T3,T5 | tables, publish RPC, prefs table | ok |
| T3 ‖ T5 | disjoint files (service/templates/handlers vs announcements.*; only T5 edits all-actions + escalation) | ok |
| T4 ‖ T2 | T4 edits core/query-defs.ts + api-query-route smoke map; T2 DB only | ok |
## Tasks
Task 1: complete (commit 86a69c4, inline)
Task 4: complete (commits ..62d9d06); Haiku; controller added teacher-forbidden + pageSize-101 tests, narrowed select (no before/after jsonb).
Task 2: complete (commits ..c5f0187, review clean)
Task 5: complete (commits ..a5a502f); controller: RLS 42501 on audience insert → validation_failed (was internal).
Task 3: complete (commits ..774b377, review clean). T3 ‖ T5 ran in parallel.
Task 6: complete (commits ..c413766)
Security review (Sonnet): 0 CRIT, 0 HIGH, 1 MED-ish, 2 LOW. Controller: audiences read in handler now also filters institution_id (defense in depth). Ruling: school/role audiences ignore guardian_students.portal_access — a general school notice is not child data; portal_access gates child-specific (grade/section) notices only. Parked: sequential per-recipient fan-out (documented shortcut, idempotent).
Gate: unit 958, db 497/498 (DBT-46 flaky invoice chunk test, passes alone), security 1382.
M06 DONE 87fa977 pushed to git; hosted 0068 pending owner.
