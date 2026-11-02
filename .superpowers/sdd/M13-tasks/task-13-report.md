# M13-T13 Documentation — Report

**Packet:** M13-T13 (CoolSkool operations documentation)

## Changes

1. **07-security-and-ai-governance.md §4**
   - Added row for M13 (migration 0075): operations definers and guards
   - Covers RLS helpers (transport routes/stops/vehicles), guard triggers (maintenance state machine, transport capacity, holiday attendance block, calendar date validation)
   - Documents the Lane B predicate for module_enabled (calendar)

2. **05-data-architecture.md §2–3**
   - Added section 2.9 (operations, migration 0075): 7 table rows (assets, maintenance_requests, transport_vehicles, transport_routes, transport_stops, transport_assignments, academic_calendar_events) with constraints, history semantics, and sensitivity
   - Renumbered lifecycle section to 2.10
   - Updated ownership matrix (§3): added three modules (facilities, transport, calendar) and their table ownership
   - Removed `transport_*` from reserved-names line

3. **03-feature-matrix.md**
   - Updated F-SVC-02: status "planned" → "limited"; removed "fee linkage" from feature title; removed F-FIN-01 dependency; changed owner from "transport (reserved)" to "transport"

## Acceptance

All facts sourced from migration 0075 and task ruling block (M13-tasks.md). Lint/typecheck deferred to task completion.

**Files changed:** 3  
**Lines added:** ~40  
**Limits documented:** manual status (no GPS), no per-grade holidays, no staff attendance block, no transport-fee linkage
