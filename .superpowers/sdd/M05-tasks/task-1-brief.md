### Task 1: M05-T1 Permissions `document.read`, `document.write`
READ: BRIEF-COMMON.md; `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `07-security-and-ai-governance.md` §2.2
FILES: `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `docs/planning/coolskool/07-security-and-ai-governance.md` (two matrix rows)
EXPORTS: `"document.read"` in all 9 role lists; `"document.write"` in owner, principal, admin, admissions.
TEST FIRST: holders of each key exactly as above.
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts`; `pnpm lint`; `pnpm typecheck`

