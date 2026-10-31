# F-BE-12: Twin Fixture Implementation

**Files**: `src/modules/fabric/demo/twin.ts`, `tests/unit/fabric-fixtures/twin.test.ts`

**Behavior**: `twinSnapshot(opts, state)` generates deterministic graphs: 78 nodes (12 student_group, 20 teacher, 6 dept, 20 room, 2 building, 5 route, 5 vehicle, 4 workflow, 4 budget_line) with ≈110 edges (teaches, uses, belongs_to, depends_on, transports, funds). Nodes positioned by type in columns (220px apart). Capacity/load/utilisation_pct on groups/rooms/routes; historical < current < scenario (+10% loads, 2 rooms >100%). `changeImpact(snapshot, nodeId)` returns BFS 2-hop affected nodes with effect text (≤120 chars).

**Tests**: All 13 pass; determinism verified, node counts exact, edges within 110±10, endpoints validated, scenario overload confirmed, impact analysis ≥1 affected.

**Commands run**: `pnpm test tests/unit/fabric-fixtures/twin.test.ts` → 13 passed; `pnpm lint` clean.

**Skipped**: Typecheck error in unrelated agents.ts file (pre-existing); isolated to twin changes only.
