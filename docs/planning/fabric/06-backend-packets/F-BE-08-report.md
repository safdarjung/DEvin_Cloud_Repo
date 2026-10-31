# Packet F-BE-08: Fixture `operations`

**Status:** Complete

**Files:** 
- `src/modules/fabric/demo/operations.ts` — 5 functions generating deterministic fixture data
- `tests/unit/fabric-fixtures/operations.test.ts` — 26 tests verifying count, seeding, bounds

**Implemented:**
- `timetableConflicts(opts)` — 7 conflicts, all 4 kinds, Mon–Sat, periods 1–8
- `teacherWorkloads(opts)` — 24 teachers, max_periods 30, some >28
- `transportRoutes(opts)` — 5 routes, 5–8 stops, coords 0–100, one delayed
- `maintenanceRequests(opts)` — 10 requests with priorities/statuses
- `roomUtilisation(opts)` — 18 rooms incl. labs, library

**Verification:**
- `pnpm test -- tests/unit/fabric-fixtures/operations.test.ts` — all 26 operations tests pass
- `pnpm lint -- src/modules/fabric/demo/operations.ts tests/unit/fabric-fixtures/operations.test.ts` — clean
- Deterministic: same seed produces identical output
- All strings ≤200 chars; coords within bounds

**No new dependencies.** Reused `rng`, PRNG utilities, name/section/subject lists from `prng.ts`.
