# M22-T1 Permissions `agent.run`, `agent.approve`

**Packet:** M22-T1 Permissions agent.run, agent.approve

**Files changed:**
- `src/lib/auth/permissions.ts`
- `tests/unit/permissions.test.ts`
- `docs/planning/coolskool/07-security-and-ai-governance.md`

**Behavior implemented:**
Added two new permissions to the matrix. `agent.run` granted to owner, principal, and admin (allows running agents, reading definitions/runs, deciding user_confirmed runs). `agent.approve` granted to owner and principal only (allows deciding human_approved runs and enabling/disabling definitions). Teacher, accountant, guardian, and student hold neither.

**Tests run:**
`pnpm test tests/unit/permissions.test.ts` → 24 passed

**Tests not run and why:**
Full test suite skipped per brief (only own task files).

**Security / integration risks:**
None. Pure permission matrix addition; no RLS or service-role changes needed (T2 adds those).

**Follow-ups:**
T2 creates migration 0095 and the table schemas with RLS policies enforcing these permissions.

**New dependencies:**
None.

**Assumptions made:**
Admin role granted `agent.run` but not `agent.approve` per rulings: only owner/principal approve human decisions.
