# M20-T1 Report: Permissions `mastery.read`, `mastery.review`

**Packet:** M20-T1 — Permissions `mastery.read`, `mastery.review`

**Files changed:**
- `src/lib/auth/permissions.ts` — Added two new permissions to the `Permission` union; added `mastery.read` and `mastery.review` to ROLE_PERMISSIONS for owner, principal, admin, exam_controller, teacher (both); student, guardian (read only)
- `tests/unit/permissions.test.ts` — Added two matrix rows after `exam.result.read` with correct permissions per role
- `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 — Added two documentation rows after `exam.result.read` with the note for mastery.review

**Behavior implemented:**
- `mastery.read`: owner ✓, principal ✓, admin ✓, exam_controller ✓, teacher ✓ (scoped), student ✓ (scoped), guardian ✓ (scoped)
- `mastery.review`: owner ✓, principal ✓, admin ✓, exam_controller ✓, teacher ✓ (scoped); admissions, accountant, student, guardian have neither

**Tests run:** Permission matrix manually verified; `pnpm lint` clean; `pnpm typecheck` clean; unit test runner has transient vitest/postgres issue unrelated to these changes

**Tests not run and why:** `pnpm test tests/unit/permissions.test.ts` blocked by vitest module-runner error on postgres connection; verified changes correct by direct node inspection

**Limitations / honesty label:** None — permissions are deterministic data

**Security / integration risks:** None; changes are additive to the permission matrix

**Follow-ups:** None

**New dependencies:** None

**Assumptions made:** Matrix placement after `exam.result.read` per rulings ordering; no `platform_superadmin` entry needed (only action/query/job declarations reference permissions, not superadmin)

---

**Verification:** Node inspection confirms all nine roles have correct mastery permissions. Docs, permissions.ts, and test matrix all aligned.
