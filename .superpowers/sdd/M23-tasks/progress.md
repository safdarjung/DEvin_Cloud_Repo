# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M23-tasks.md
Spec: 07-master-plan §3 M23, D43. Migration 0096 (claimed 2026-11-02 in 10-backlog-index §3; V2 renumber from 0056). Module `workflows` (default off). Rulings in task-file header (4 deviations: SQL metrics not registered queries; invoice overdue = schedule + metric; agent node queues a run for `agent.start`; in-place version + run graph snapshot).
Prereqs before dispatch: MOD, M08, M09, M12, M15, M16, M22 merged. M22 missing → T10/T19 + agent branch of T18 BLOCKED.
Routing: T1 haiku none [] ; T2 sonnet exclusive [] ; T3 sonnet exclusive [2] ; T4 sonnet exclusive [3] ; T5 haiku none [1] ; T6 haiku none [] ; T7 sonnet none [5] ; T8 opus none [7] ; T9 haiku none [7] ; T10 sonnet tests [2] ; T11 sonnet tests [4,6,8,10] ; T12 sonnet tests [3,11] ; T13 sonnet none [3] ; T14 sonnet tests [3,5] ; T15 sonnet tests [1,2,5,7] ; T16 sonnet tests [3,15] ; T17 sonnet tests [1,2,5] ; T18 sonnet tests [1,2] ; T19 sonnet tests [] ; T20 sonnet exclusive [2,9] ; T21 sonnet tests [12,13,14,16,17,18,19,20] ; T22 haiku none [21]
Reviews (Sonnet security): after T3, T11, T12, T15, T16, T19.
## Tasks
(none started)
