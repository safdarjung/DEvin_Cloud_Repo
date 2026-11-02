# M13-T3 Facilities + Calendar Zod Schemas

**Packet:** M13-T3

**Files changed:**
- `src/modules/facilities/schemas.ts` (new)
- `src/modules/calendar/schemas.ts` (new)
- `tests/unit/facilities-calendar-schemas.test.ts` (new)

**Behavior implemented:**
Zod schemas for facilities and calendar modules with comprehensive validation. Facilities exports: asset CRUD schemas (upsert, list), maintenance request schemas (create, assign, close, list) with required assetId-or-location refinement. Calendar exports: event schemas (upsert, delete, query) with date boundary and audience constraints (holiday ⇒ audience all, span ≤ 92 days for events, span ≤ 366 days for queries). All schemas `.strict()` with inferred `*Input` types exported. Constant arrays for enums.

**Tests run:**
```
pnpm test tests/unit/facilities-calendar-schemas.test.ts
→ 67 passed (100%)
  - AssetUpsertSchema: 11 tests (valid inputs, length validation, unknown keys)
  - MaintenanceRequestSchema: 8 tests (assetId-or-location refine, 500-char issue limit)
  - MaintenanceAssignSchema: 3 tests (UUID validation, strict mode)
  - MaintenanceCloseSchema: 4 tests (optional note, 500-char limit)
  - AssetListSchema, MaintenanceListSchema: 2 tests each
  - CalendarEventUpsertSchema: 15 tests (dates, span, holiday-audience, kind validation)
  - CalendarEventDeleteSchema: 3 tests
  - CalendarForRoleSchema: 10 tests (date range, 366-day limit, kinds max 4)
  - Constants: 4 tests
```

**Lint & Typecheck:**
```
pnpm lint → 0 errors
pnpm typecheck → no facilities/calendar errors
```

**Tests not run:** None (all unit tests passing).

**Limitations / honesty label:** None. All constraints from M13 T3 spec implemented.

**Security / integration risks:** None. Schemas are read-only validation layers; no DB mutations or external calls.

**Follow-ups:** None. T3 complete; ready for action/query implementations (T5–T10).

**New dependencies:** None.

**Assumptions made:**
- `isoDate` and `uuid` from `src/lib/schemas/common.ts` are Zod parsers for ISO dates and UUIDs respectively.
- Date span calculations use JS `Date` arithmetic (milliseconds / (24 * 60 * 60 * 1000)).
- Strict mode (`z.object().strict()`) prevents extra fields; mirrors timetable module pattern.
