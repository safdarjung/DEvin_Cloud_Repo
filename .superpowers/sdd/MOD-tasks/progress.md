# SDD ledger — plan: docs/planning/fabric/06-backend-packets/MOD-tasks.md
Spec: owner directive 2026-11-02; ADR D45 (12-decision-log.md); 07-master-plan §3 MOD block (supersedes M26 foundation). Rulings + key map in task-file header.
Prereq: batch 2 (M08–M14, M17) merged — they shipped without module keys; T6–T9 retrofit them.
Routing: T1 haiku none [] ; T2 sonnet none [1] ; T3 haiku none [1] ; T4 sonnet tests [1,2,3] ; T5 haiku none [3,4] ; T6 haiku none [2] ; T7 haiku none [2,3] ; T8 haiku tests [2,3] ; T9 haiku none [2,3] ; T10 haiku none [1,3] ; T11 sonnet tests [1,4] ; T12 sonnet exclusive [1] ; T13 sonnet tests [4,6,7,8,9] ; T14 haiku exclusive [1]
Migration: 0084 `module_enabled` (claim at dispatch; next spare if taken). T12/T14 exclusive — serialize.
Planner rulings beyond the directive (see D45 "Refined"): every definition declares `module` incl. core keys (T13 makes it required); `substitution` own key (requires staff_attendance + timetable); exam schedule folded into `exams`; period attendance → `timetable`; `website` disable blocked while live; Razorpay webhook never gated (overrides M12-tasks); defaults on for everything built by M01–M14/M17, off for M15 + Intelligence.
## Tasks
(none started)
