# M06-T4 `core.audit.list` Query Implementation Report

## Summary

Implemented M06-T4: `core.audit.list` read query for audit event viewer. Query returns paginated, institution-scoped audit events with actor names/roles enriched from profiles and memberships tables.

## Files Changed

1. **src/modules/core/audit.queries.ts** (NEW)
   - `listAuditEvents(ctx, filters)` → `{ rows: AuditEventRow[], total: number }`
   - Filters: `from?`, `to?`, `action?`, `entityType?`, `page=1`, `pageSize=50 (max 100)`
   - Pagination via offset/range; ordering by `created_at DESC` (newest first)
   - Two lookups: profiles for actor names, memberships for actor roles
   - Maps raw rows to AuditEventRow with computed `actor`, `actor_role`, `event`, `entity`, `summary`

2. **src/modules/core/query-defs.ts** (EDIT)
   - Added `listAuditEventsQuery` using `defineQuery`
   - Query name: `core.audit.list`
   - Permission: `audit.read`
   - Zod schema: dates (datetime ISO), strings (max 100), page (≥1), pageSize (1–100)

3. **tests/db/audit-list-query.test.ts** (NEW)
   - 4 tests: newest-first ordering, action filtering, institution isolation, pageSize clamping
   - Uses `createTestInstitution`, `buildContext`, `setActingClient` pattern
   - SQL inserts for audit event fixtures with valid UUIDs

4. **tests/db/api-query-route.test.ts** (EDIT)
   - Added sample input: `"core.audit.list": { page: 1 }`

## Test Results

```
test:db (audit-list-query.test.ts + api-query-route.test.ts):
  Test Files  2 passed (2)
  Tests  11 passed (11)

test (action-names-unique.test.ts):
  Test Files  1 passed (1)
  Tests  4 passed (4)

lint && typecheck: ✓ clean
```

## Concerns

None. Query function is minimal, RLS enforces institution isolation, permission gate is at the API level (defineQuery wrapper). No unrequested features; return type matches AuditEventRow contract exactly.

## Checklist

- [x] Test file RED → test runs
- [x] Query function implements all filter/pagination logic
- [x] Query def with Zod schema + permission gate
- [x] Sample input for API smoke test
- [x] Tests GREEN → all pass
- [x] Lint clean
- [x] Typecheck clean
- [x] No new dependencies
- [x] Institution isolation verified (RLS + explicit `eq("institution_id"...)`)
