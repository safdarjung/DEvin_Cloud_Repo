# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M07-tasks.md
Spec: 07-master-plan §3 M7. Rulings in task-file header. Routing (owner 2026-11-01, new account): Sonnet + Haiku only; T1 inline, T3 Haiku, rest Sonnet. Parallel T2‖T3 → T4‖T5‖T6 → T7.
## Tasks
Task 1: complete (commit 4e6542b, inline)
Task 3: complete (commits ..60ac1ec); Haiku. Controller restyled to repo style; controller bug emptied the untracked test file, Haiku restored it.
Task 2: complete (commits ..f8af0af, review clean)
Controller defect: M07 card under-specified slot columns; 0069 shipped without timetable_slots.subject_id (found by T4). Amended unpushed 0069 (subject_id NOT NULL FK bound in policies, rooms.kind), applied locally (local slots cleared), types regenerated; T4 fix round (actions + RLS test fixtures), T5/T6 notified mid-run.
Task 4: complete (commits ..a4a8fa2); 1 fix round (subject_id/kind wiring + RLS fixtures).
Task 5: complete (commits ..73545d9, review clean)
Task 7: complete (commits ..1f45b87); Haiku. Found real defect: defaultPublishedVersionId joined academic_years (staff-only RLS) → guardians got no timetable; controller fixed (latest published version).
Security review (Sonnet): 0 CRIT/HIGH/MED, 2 LOW parked (manager can edit academic_year_id on a published version — unique index holds; per-row definer guard calls on ≤500-row saves).
Task 6: complete (commits ..5680305)
Gate: unit 1008, db 524, security 1468 green.
