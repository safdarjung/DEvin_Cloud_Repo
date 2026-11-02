# M11-T1 Completion Report: Permission `question.manage`

Packet: M11-T1 Permission `question.manage`

Files changed:
- `src/lib/auth/permissions.ts` (Permission type + ROLE_PERMISSIONS for owner, principal, exam_controller, teacher)
- `tests/unit/permissions.test.ts` (MATRIX row added)
- `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (permission row added)

Behavior implemented: Added new permission `question.manage` to the permission matrix. Granted to owner, principal, exam_controller, and teacher (scoped by RLS to taught grade + subject). Not granted to admin, admissions, accountant, student, or guardian.

Tests run: `pnpm test tests/unit/permissions.test.ts` → 18 passed (18)

Security / integration risks: None. Permission scope enforcement via RLS will be verified in M11-T2 (migration and RLS tests).

New dependencies: None.

Assumptions made: MOD module key `question_bank` assumed to exist or be added by another packet; not required for this permission-only task.
