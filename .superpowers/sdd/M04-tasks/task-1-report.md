# Task 1 report — M04-T1 permission `data.import`

Files changed:
- `src/lib/auth/permissions.ts` — added `"data.import"` to `Permission` union; added to `owner`, `principal`, `admin` role arrays only.
- `tests/unit/permissions.test.ts` — added `data.import` row to MATRIX (own/pri/adm true, rest false) + dedicated test "data.import is held by exactly owner, principal, admin".
- `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 — new matrix row `| data.import | ✓ | ✓ | ✓ | | | | | | |` after `job.manage`.

TDD: added test first (RED — 4 failures: data.import missing from matrix/role lists), then implemented (GREEN).

Tests: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts` → 2 files, 12/12 passed.
`pnpm lint` clean. `pnpm typecheck` clean.

No deviations from brief. No new deps. No DB/seed touched.
