# SDD ledger — plan: docs/planning/fabric/06-backend-packets/X06-tasks.md
Spec: owner directive 2026-11-02 (extension X06 "Exam seating plan + admit cards", owner-approved); D45 module system. Rulings in task-file header.
Prereq: MOD merged (catalog, `module` required, 0084 `app.module_enabled` + drift test, `allModulesOn()` fixtures) and M11 merged (0073 schedule columns, `institutionTimeZone`/`localParts`, `escapeHtml`, `toHtmlResponse` + `?format=html`).
Routing: T1 haiku none [] ; T2 sonnet exclusive [1] ; T3 sonnet exclusive [2] ; T4 haiku none [] ; T5 sonnet tests [1,3,4] ; T6 sonnet tests [1,3,4] ; T7 haiku none [4] ; T8 sonnet tests [6,7] ; T9 sonnet tests [5,8] ; T10 sonnet exclusive [3] ; T11 haiku none [9,10]
Migration: 0088 `exam_seating` (claimed 2026-11-02; directive said 0089, held by X05). T2/T3/T10 exclusive — serialize. T1+T2 one commit (drift test red between).
Ordering hazard: 0085–0089 (X01, X03, X04, X06, X05) each re-create `app.module_enabled` whole; build in number order, each from the predecessor's body. T2 stops BLOCKED if 0089 is already built.
Planner rulings beyond the directive: slot = (exam_id, scheduled_at); writes only via definer `generate_seating_plan` (no DML grants); interleave in SQL by (rank in section, section rank in grade, grade); generation reuses `exam.manage`; one new key `exam.seating.read` (own/pri/adm/exc ✓, stu/grd s; teacher none); `exam_name` snapshot on plan (guardians cannot read draft exams); guardian/student see own seat, not admit card (exam_papers staff-only); seed dates relative to run day (ids fixed).
## Tasks
(none started)
