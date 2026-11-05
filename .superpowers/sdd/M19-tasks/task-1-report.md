# M19-T1: Permissions + CONTRACT fields — Completion Report

**Packet:** M19-T1 Permissions + CONTRACT fields

**Files changed:**
- `src/lib/auth/permissions.ts` — Added `insight.read` and `insight.review` to Permission type and ROLE_PERMISSIONS matrix
- `tests/unit/permissions.test.ts` — Added matrix row, role assertions for insight permissions
- `src/modules/fabric/types.ts` — Added `InsightExplanation` interface, extended `Insight` with `signal?`, `detector_version?`, `explanation?`
- `docs/planning/coolskool/07-security-and-ai-governance.md` — Added two rows to 07 §2.2: insight.read and insight.review
- `docs/planning/fabric/05-data-contracts.md` — Added M19 CONTRACT fields to 0054 Insight definition

**Behavior implemented:**
- `insight.read`: owner, principal, admin, admissions, accountant, exam_controller, teacher (RLS enforces scoped visibility)
- `insight.review`: owner, principal, admin, admissions, accountant, exam_controller (review & action permission)
- `InsightExplanation`: captures AI explanation (what, why, next_steps, provider, model, explained_at)
- `Insight` CONTRACT fields: signal (detector key), detector_version (1+), explanation (null or full struct)

**Tests run:**
- `pnpm test tests/unit/permissions.test.ts` → 23 passed (8 new tests for insight permissions)
- RED: tests failed on missing insight.read/review (confirmed)
- GREEN: all tests pass after permissions added

**Tests not run and why:**
- No db tests (T1 has no migration)
- No fixtures replicated (T1 replaces none per brief)

**Limitations / honesty label:**
None. Full implementation per brief.

**Security / integration risks:**
None. Permissions are purely additive; RLS policies (T2) will enforce scoping.

**Follow-ups:**
T2 writes RLS policies that consume these permissions; T7 uses signal keys and permission names.

**New dependencies:**
None.

**Assumptions made:**
- `ai.generate` pre-check for explanation writing is handled separately (T2 definer notes)
- Teacher RLS branch (attendance/academics of taught sections) is RLS-enforced, not permission-enforced
