Packet: X01-T2 Permissions student_leave.request, student_leave.approve, diary.write
Files changed: src/lib/auth/permissions.ts, tests/unit/permissions.test.ts, docs/planning/coolskool/07-security-and-ai-governance.md
Behavior implemented: Added 3 new permissions to the matrix: student_leave.request (guardian only, scoped to own children), student_leave.approve (owner/principal/admin/teacher scoped), diary.write (owner/principal/admin/teacher scoped). Updated Permission union type, ROLE_PERMISSIONS mappings for all roles, test matrix, and the 07 §2.2 permission table in docs.
Tests run: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts` → 19 passed
Tests not run and why: DB and security tests skipped per task scope (T2 is schema/permissions only)
Limitations / honesty label: None. Permissions are role grants; scope (own children, taught sections) enforced by RLS and handler logic per comment in permissions.ts.
Security / integration risks: None identified. Scoping will be validated by T4 (SQL migration) and T6–T8 (action/query implementations).
Follow-ups: T3–T13 build on these permissions
New dependencies (justification): None
Assumptions made: None. Permission matrix mirrors 07 §2.2 rulings exactly; scoping details from the spec.
