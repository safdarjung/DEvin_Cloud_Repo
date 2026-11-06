Packet: F-UI-09 School digital twin (lane: twin)

Files changed:
- src/app/(tenant)/[institution]/fabric/twin/page.tsx
- src/modules/fabric/twin.queries.ts (new)
- src/modules/fabric/twin.mapping.ts (new, pure)
- src/modules/fabric/components/twin/{nodes,twin-canvas,state-toggle,entity-drawer,legend,twin-workspace}.tsx (new)
- tests/unit/twin-mapping.test.ts (new)

Behavior implemented: `PlannedWorkspace` removed. `twinSnapshot(ctx, "current"|"historical")`
builds a real TwinSnapshot from owner tables/queries: class_sections+enrolments
(student_group: enrolment vs capacity, falling back to enrolment count when
capacity isn't configured — rule 7, no invented cap), rooms+periods+timetable_slots
(room: periods used vs bell-schedule periods/week, mirrors timetable.queries.ts's
timetableRoomUtilisation but keeps room id for the graph), timetable.queries.ts's
timetableTeacherWorkload (teacher: periods/week vs max/week, reused as-is),
transport.queries.ts's transportRoutes (route: assigned students vs vehicle
capacity, reused as-is). Edges: teaches (teacher→section), uses (section→room)
from timetable_slots; transports (route→section) derived by joining each
route's transport_assignments to the assigned student's active enrolment.
`changeImpact`'s pure graph-walk is demo/twin.ts's own function, reused
unchanged. React Flow canvas reuses @/lib/genui/flow-canvas (not
reimplemented); custom node renderer colours by utilisation tier (≤80 ok/
≤100 watch/>100 critical) and, while "Show impact" is active, rings the
affected nodes by changeImpact's severity. Entity drawer: facts, connected
nodes by relation (click → focus), Show/Hide impact with the affected list,
Open record (→ /attendance for student_group, /students for teacher per
packet; hidden for room/route — no real destination). Legend with type
filter chips. Search box focuses (opens the drawer for) the first matching
node by label. Export downloads the current snapshot JSON. "Open simulator"
links to /fabric/simulator (still planned on this base; other lane's job).

State toggle: Current always; Historical only when `twinHasHistorical(ctx)`
finds an archived timetable version — RLS (0069) already restricts archived
versions to owner/principal/admin, so non-leadership callers correctly see
no Historical option rather than an RLS-emptied graph. On this seeded base
there is exactly one timetable_version (status=published, no archived one
yet), so Historical is hidden for every role right now — honest, not a bug.
Scenario is not a selectable state at all: no saved-scenario table exists
on this base (simulator lane 0106 not merged here), so it only appears as a
LimitedBadge caption next to the toggle ("needs a saved simulator scenario").
Forecast overlay (packet's forecast-overlay.tsx) is omitted entirely: the
only two real forecast kinds (fee_collections_term, attendance_rate_week,
src/modules/forecasts/schemas.ts) have no room/route/capacity metric to
overlay, and inventing one would violate rule 7 — "else omit" per lane brief.
No migration (none needed).

Tests run:
- `pnpm test tests/unit/fabric-fixtures/twin.test.ts tests/unit/flow-from-spec.test.ts tests/unit/twin-mapping.test.ts` → 25/25 passed (packet's own check command plus the new mapping unit tests).
- `pnpm test tests/unit` → 2651/2651 passed (no regressions).
- `pnpm lint` → 0 errors (pre-existing unrelated warnings only, in files this packet didn't touch).
- `pnpm typecheck` → clean.
- DB sanity (read-only `psql`, no schema/data change): confirmed the demo tenant has non-trivial real data behind every node type — 3024 timetable_slots, 72 class_sections (all 72 already have capacity set, so the enrolment-fallback branch is untested live but is unit-tested), 7 non-break periods, 4 transport_routes each at 30/40 assigned, 100 teaching staff, 3024 active enrolments.

Tests not run and why: no `tests/db/twin-*.test.ts` — this lane adds no table/RLS;
every read composes already-DB-tested owner functions (transportRoutes,
timetableTeacherWorkload) or mirrors timetableRoomUtilisation's proven
aggregation 1:1 with id kept. Did not verify in an actual browser: no Chrome
binary in this environment (`playwright install chrome` required, blocked);
verified instead via typecheck+lint+unit tests plus the DB sanity query above
confirming every table my queries join has real, non-empty, sane data for
the seeded demo tenant.

Limitations / honesty label: Historical hidden on this base (no archived
timetable_version yet) — LimitedBadge not shown for Historical specifically
since it's just absent, not promised-then-limited; Scenario shown with
LimitedBadge always (no scenario table). Forecast overlay omitted (no
applicable real forecast metric). Open record hidden for room/route nodes
(no real destination page for those types). No building/department/vehicle/
workflow/budget_line nodes (demo fixture's richer node set) — only the 4
types an owner module can back with real capacity/load today.

Security / integration risks: none identified. Every query filters by
`ctx.institution.id` (defense in depth) and relies on existing RLS (0069
timetable, 0075 transport) for actual row visibility; no new table, no new
permission, no action/mutation added (read-only lane). "Open record" and
"Open simulator" are plain `Link`s, not actions.

Follow-ups: once the simulator lane's `simulation_scenarios` table (0106)
merges, wire the Scenario toggle to read saved scenarios and apply
`enrolment_delta_pct` client-side (packet's original design) instead of the
LimitedBadge. No new debt-log entries beyond that expected follow-up.

New dependencies (justification): none.

Assumptions made: room node capacity/load = periods/week (bell-schedule
usage), not room seating capacity, per lane brief wording "rooms (capacity
vs timetable usage)". Route→section "transports" edges are derived (not an
existing owner query) by joining transport_assignments to each student's
active enrolment section — acceptable per "Server data: new read functions
... that call owner modules' queries.ts" since no existing function exposes
this join. "Open record" targets for student_group/teacher are taken
literally from the F-UI-09 packet text, including the teacher→/students
"for now" placeholder.
