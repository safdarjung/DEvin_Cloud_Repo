# M18-T1 Backup helpers — Completion Report

**Packet:** M18-T1 Backup helpers

**Files changed:**
- `scripts/lib/backup.ts` (new)
- `tests/unit/backup-lib.test.ts` (new)

**Behavior implemented:**
Pure utility library for M18 backup/restore ops. Exports 10 functions + 3 constants:
- Constants: `DATA_SCHEMAS`, `DRILL_PROJECT_ID`, `DRILL_EXCLUDES`, `SHARED_LOCAL_DB_PORT`
- Helpers: `backupDirName()`, `quoteIdent()`, `isLoopbackHost()`, `redactDbUrl()`, `assertRestoreTarget()`, `drillConfig()`, `policyDdl()`, `sha256File()`, `countsMismatch()`
- Type: `PolicyRow` interface

All functions are pure (no side effects), use only `node:*` imports, and are tested comprehensively.

**Tests run:**
```
pnpm test tests/unit/backup-lib.test.ts
→ 37 tests PASSED, 0 failed
```

**Tests not run and why:**
Integration tests (db-backup.ts, db-restore.ts, db-drill.ts) are in later tasks (T2–T4).

**Limitations / honesty label:**
None. Pure lib, no UI/data concerns.

**Security / integration risks:**
`redactDbUrl()` and `assertRestoreTarget()` properly guard against secret leakage. All sensitive log output is redacted.

**Follow-ups:**
T2 depends on this lib (db-backup.ts).

**New dependencies:**
None.

**Assumptions made:**
- Date formatting uses UTC (getUTCFullYear, etc.)
- Label validation pattern `^[a-z0-9-]{1,20}$` as specified in rulings
- `drillConfig()` replaces only in `[db.seed]` section and leaves `[api]` untouched per rulings

**Lint/typecheck:** Clean (backup files only).
