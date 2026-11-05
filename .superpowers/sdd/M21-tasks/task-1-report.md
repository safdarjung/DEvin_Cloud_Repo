# M21-T1 Permission `forecast.read` — Report

**Packet:** M21-T1 Permission `forecast.read` (Haiku)

**Files changed:**
- `src/lib/auth/permissions.ts` (Permission type + ROLE_PERMISSIONS matrix)
- `tests/unit/permissions.test.ts` (test matrix row for snapshot)
- `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (one permission row)

**Behavior implemented:**
Added `forecast.read` permission to the six roles: owner, principal, admin, accountant, exam_controller, teacher. Removed from admissions, student, guardian. Snapshot test verifies matrix consistency with documentation.

**Tests run:**
- `pnpm test tests/unit/permissions.test.ts` → 18 passed

**Tests not run and why:**
None; this is a unit-only change with no DB or integration surface yet.

**Limitations / honesty label:**
None. Permission is defined; RLS and queries that enforce it are follow-up tasks (M21-T2 onwards).

**Security / integration risks:**
None. Permission is inert until enforced by RLS policies and action checks. No breaking change to existing code paths.

**Follow-ups:**
T2 (migration + RLS), T4–T12 (queries, engine, job, acceptance).

**New dependencies:**
None.

**Assumptions made:**
Role column order in permission matrix matches `ROLE_ORDER` in test (owner, principal, admin, admissions, accountant, exam_controller, teacher, student, guardian).

---

**Acceptance:** `pnpm test tests/unit/permissions.test.ts` ✓ (18 passed); `pnpm lint` ✓; `pnpm typecheck` ✓ (no errors).
