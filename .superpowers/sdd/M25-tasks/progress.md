# M25 ledger — Briefings + AI timetable suggestions

Plan: `docs/planning/fabric/06-backend-packets/M25-tasks.md`. Spec: `07-master-plan-v1-v2.md` §3 M25, D43. Rulings are in the task-file header. Modules `ai_briefings` (default on) and `timetable` (default on). No new deps, permissions or job types.

Migration: none. Recorded as "M25: no migration" in `10-backlog-index.md` §3 (2026-11-02). M25 writes M19's `briefings` (0092) through the new service-role caller `briefings`.

Routing: T1 haiku none [] ; T2 sonnet none [1] ; T3 opus none [] ; T4 sonnet tests [2] ; T5 sonnet tests [4] ; T6 haiku none [] ; T7 sonnet tests [4,6] ; T8 sonnet tests [3] ; T9 sonnet tests [5,7,8] ; T10 haiku none [9]

Parallel order:
- T1 ‖ T3 ‖ T6 first.
- T2 after T1; T8 after T3.
- T4 after T2; then T5 ‖ T7 (T7 also needs T6).
- T9 after T5, T7, T8; then T10.
- No DB-exclusive task (no migration, no `db:types`); db test files are per-task and may overlap.

## Planning facts (verified 2026-11-02, no DB commands)
- The job path is impossible without a migration: the runner holds only the service role under plain node, cannot import `gateway.ts`, and cannot run registered queries under RLS (M15 "sources are SQL", M22 in-request precedent). M25 generates in-request; T10 records the D-number.
- M19's `briefings` key is `(institution_id, role, brief_date)`, so a row is read by every member of its role. Sources must be role-uniform. Teacher RLS is section-scoped, so the teacher recipe is only `calendar.forRole` + `exams.schedule` (`exams`/`exam_papers` SELECT = all staff, 0009). `core.approvals.pending` `agent_run` rows are per-user (M22) and are excluded.
- Owner and principal have identical permission lists (`permissions.ts`), so they share the `principal` row. Admin differs (no `exam.recheck.*`), so it gets an `admin` row from the same recipe.
- `runStructured` checks `ai.generate` itself. Teacher lacks `dashboard.view`, so the route moves to M19 `insight.read` and checks `ai.generate` before any write.
- `DashboardBriefingRequestSchema` stays; `DailyBriefing.tsx` keeps posting numbers that the route ignores (Workstream D).
- `max_rows = 1000`; the demo tenant has ~3,400 slots. `timetable.suggest` must page `timetable_slots` (M19 found bug in M07 queries). T8 has a 1,007-slot paging test.
- No `insights.signal` value exists for unfilled cells, so suggestions are returned in `insight_action` shape, not stored (debt).
- 2026-11-02 is a Monday (T4 weekly test date).
- M19's task file still names 0054; the backlog index (authoritative) says 0092.

## Tasks
(none started)
