### Task 1: M04-T1 Permission `data.import`
READ: BRIEF-COMMON.md; `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (matrix table)
FILES: `src/lib/auth/permissions.ts` (edit); `tests/unit/permissions.test.ts` (edit); `docs/planning/coolskool/07-security-and-ai-governance.md` (edit: one matrix row)
EXPORTS: `"data.import"` in the `Permission` union and in owner, principal, admin lists only.
TEST FIRST: "data.import is held by exactly owner, principal, admin".
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts`; `pnpm lint`; `pnpm typecheck`

