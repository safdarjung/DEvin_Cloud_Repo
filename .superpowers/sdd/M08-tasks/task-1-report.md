# M08-T1 Completion Report

**Packet:** M08-T1 Permissions `staff.attendance.mark`, `leave.request`, `leave.approve`

**Files changed:**
- `src/lib/auth/permissions.ts` (added 3 permissions to union + 7 role arrays)
- `tests/unit/permissions.test.ts` (added 3 test matrix rows)
- `docs/planning/coolskool/07-security-and-ai-governance.md` (added 3 rows to §2.2 matrix table)

**Behavior implemented:**
Added three M08 staffing permissions to the permission matrix: `staff.attendance.mark` (owner/principal/admin/admissions/accountant/exam_controller/teacher, scoped self-only for non-leadership); `leave.request` (same roles, scoped own-leave); `leave.approve` (owner/principal/admin only, enforces never-own via RLS/handler).

**Tests run:**
```
pnpm test tests/unit/permissions.test.ts
→ Test Files 1 passed (1)
→ Tests 11 passed (11)
```

**Tests not run and why:**
Full unit suite skipped per BRIEF-COMMON — running only own task file. No DB tests in this packet.

**Limitations / honesty label:**
None. Matrix cells are TypeScript boolean literals; scoping (`s` notation) is enforced by RLS and handler logic in later tasks (T2–T8).

**Security / integration risks:**
None. Permissions are declarations only; authorization checks happen via `requirePermission(ctx, perm)` in actions and RLS policies (not written in this task).

**Follow-ups:**
T2–T4 (migration + RLS) and T7–T8 (actions) implement the actual guards.

**New dependencies:**
None.

**Assumptions made:**
- `s` (scoped) cells are treated as `true` in the permission matrix; handler/RLS narrows scope.
- Alphabetic order of new permissions after `timetable.read` for readability.
