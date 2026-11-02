Packet: M13-T1 Permissions + module keys
Files changed: src/lib/auth/permissions.ts; tests/unit/permissions.test.ts
Behavior implemented: Permission union extended with `facilities.manage`, `transport.manage`, `maintenance.request`. ROLE_PERMISSIONS updated: `facilities.manage` and `transport.manage` granted to owner/principal/admin; `maintenance.request` granted to all 7 staff roles (owner, principal, admin, admissions, accountant, exam_controller, teacher). Test matrix added 3 rows; role-specific checks added.
Tests run: `pnpm test tests/unit/permissions.test.ts` → 18 passed; `pnpm lint` → clean; `pnpm typecheck` → 2 errors (unrelated: exam-schedule-conflicts.test.ts from concurrent task)
Tests not run and why: docs update (T13 task); module catalog entries (MOD owns)
Limitations / honesty label: none
Security / integration risks: none
Follow-ups: none
New dependencies: none
Assumptions made: concurrent agent already added `question.manage` to code — preserved during merge
