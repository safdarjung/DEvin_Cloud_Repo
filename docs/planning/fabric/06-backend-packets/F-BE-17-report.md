# F-BE-17: Fixture `data` — Report

**Packet:** F-BE-17 fixture `data`
**Files changed:** `src/modules/fabric/demo/data.ts`, `tests/unit/fabric-fixtures/data.test.ts`

## Behavior implemented

Four deterministic fixture functions: `connectors()` returns 8 connectors (Tally, Razorpay, WhatsApp, Google Workspace, Bus GPS, Biometric, CBSE, Koha) with mixed statuses and one failed; `connectorSyncs()` returns 20 syncs over last 7 days; `dataQualityScores()` returns 8 entity quality scores (students, guardians, staff, attendance, marks, invoices, timetable, transport); `lineage()` returns ~30 nodes and ~40 edges in a source→table→metric→report graph with 220px column spacing. All functions deterministic on seed, strings ≤200 chars.

## Tests run

`pnpm test -- tests/unit/fabric-fixtures/data.test.ts`

Pass: 28 tests in data.test.ts (connectors, connectorSyncs, dataQualityScores, lineage, determinism across all fixtures).

## Security / integration risks

None. Fixtures are demo data only, never touch auth, permissions, or data.

## Assumptions made

- ISO date strings lose time component (00:00:00Z), so test compares date strings, not timestamps
- PRNG seed 7 default; determinism verified with same/different seed tests
- Graph nodes positioned deterministically at x=0, 220, 440, 660 (column width 220px)

