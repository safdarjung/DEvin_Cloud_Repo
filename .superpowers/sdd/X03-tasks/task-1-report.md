# X03-T1 Report: Module key, settings block, permissions

**Packet:** X03-T1 Module key, settings block, permissions (Haiku)

**Files changed:**
- `src/lib/modules/catalog.ts` (library module entry added)
- `src/lib/auth/permissions.ts` (library.manage & library.read permissions for all roles)
- `src/modules/core/schemas.ts` (library settings block + whatsapp schema sync)
- `tests/unit/library-config.test.ts` (new, 19 tests)

**Behavior implemented:**
Module `library` registered with category Operations, default false. Settings block validates loan_days (1–90, default 14), fine_per_day (0–100, default 1), max_loans_student (1–10, default 2), max_loans_staff (1–20, default 5). Permissions: owner/principal/admin have both library.manage and library.read; teacher/accountant/exam_controller/admissions have library.read only; student/guardian have library.read only.

**Tests run:**
- `pnpm test tests/unit/library-config.test.ts` → 19 passed
- `pnpm test tests/unit/permissions.test.ts` → 53 passed (includes library permission matrix rows)
- `pnpm test tests/unit/modules-catalog.test.ts` → 28 passed (allModulesOn now matches schema)
- `pnpm test tests/unit/institution-settings.test.ts` → parse tests pass
- `pnpm lint` → clean
- `pnpm typecheck` → clean

**Tests not run and why:** None; acceptance criteria fully covered.

**Limitations / honesty label:** None; this is backend config only (no UI).

**Security / integration risks:** None; permissions matrix and schema validated; RLS and action authorization will be enforced in T2–T6.

**Follow-ups:** T2 (migration 0086, db owner) can now proceed; audit events will be added T3; queries in T7.

**New dependencies:** None.

**Assumptions made:** whatsapp module was added concurrently by another task; added to schema to maintain catalog/schema consistency.
