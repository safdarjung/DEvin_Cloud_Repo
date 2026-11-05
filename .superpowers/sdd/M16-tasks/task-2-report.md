# M16-T2: Seeded-tenant test helper

**Packet:** M16-T2 "Seeded-tenant test helper" (CoolSkool backend plan)

**Files changed:**
- `tests/helpers/demo-context.ts` (new)
- `tests/db/dashboard-queries.test.ts` (imports refactored)

**Behavior implemented:**
Extracted seeded-tenant test helpers into a reusable module. Moved `signInDemo`, `buildDemoContext`, `timed` from inline definitions. Added `withModules(ctx, overrides): TenantContext` to merge module settings in-memory without DB writes. Helper now resolves `st-josephs-demo` institution internally on first use and throws "run `pnpm db:reset` first" when missing. Exported `closeDemoHelper()` to cleanly shut down the postgres pool.

**Tests run:**
```
pnpm test:db tests/db/dashboard-queries.test.ts
→ Test Files  1 passed (1)
→ Tests  8 passed (8)
pnpm lint tests/helpers/demo-context.ts tests/db/dashboard-queries.test.ts → clean
pnpm typecheck → clean (no errors in touched files)
```

**Tests not run and why:**
None. This is a pure refactor; T2 specifies no new test blocks, only that existing assertions remain green. Task ACCEPT requires only the single file test.

**Limitations / honesty label:**
None. Refactor only; no new features, no honesty badges needed.

**Security / integration risks:**
None. Postgres pool is private to the helper, exported only as read-only state (`sql`, `institutionId`) for tests that query directly. No secrets exposed. RLS and mocking unchanged.

**Follow-ups:**
None for this task.

**New dependencies:**
None.

**Assumptions made:**
- Every test that uses `sql` directly calls `buildDemoContext` first, triggering lazy initialization. ✓ Verified in test file.
- Exporting mutable references (`sql`, `institutionId`) is acceptable since tests own the module state and run serially. ✓ Pattern matches existing test helpers.
- Non-null assertions (`sql!`) added where needed because `sql` is `null` until initialized. ✓ Tests confirm safe usage order.
