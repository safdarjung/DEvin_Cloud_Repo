# M09-T1 Completion Report

**Packet:** M09-T1 Permissions `assignment.submit` (student) + `document.write` for student; matrix test + 07 §2.2 rows

**Files changed:**
- `src/lib/auth/permissions.ts` — added `assignment.submit` to Permission union; added to student role array
- `tests/unit/permissions.test.ts` — added matrix row for `assignment.submit` [f,f,f,f,f,f,f,t,f]; updated `document.write` row student column to true
- `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 — added `assignment.submit` row; updated `document.write` note and stu column

**Behavior implemented:**
Student can now submit assignments (new `assignment.submit` permission) and write documents on own ungraded submissions (existing `document.write` expanded to student). RLS and action handlers enforce scope. Permissions matrix snapshot test validates all 9 roles against 07 §2.2.

**Tests run:**
```bash
pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts
→ Test Files 2 passed (2) | Tests 12 passed (12)
```

**Tests not run and why:**
Full `pnpm test:security` not run per BRIEF-COMMON.md (non-owner, single-task db test scope); security/escalation tests M09-T4 (actions) and M09-T5 (documents) will exercise the new permissions in their tests.

**Limitations/honesty label:**
None. Permission matrix is read-only in code; RLS/action authorization is the enforcement (M09-T2 migration + T4/T5 actions).

**Security/integration risks:**
None. New permissions are student-only, scoped by RLS. No dependencies on T2-T7.

**Follow-ups:**
None for this packet.

**New dependencies:**
None.

**Assumptions made:**
- Matrix column order in test matches 07 §2.2 role order (verified by snapshot test)
- TDD RED-GREEN confirmed: test failed before implementation, passed after
