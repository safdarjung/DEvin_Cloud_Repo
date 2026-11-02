Packet: T-008 M13-T8 Facilities queries
Files changed: src/modules/facilities/queries.ts (new), src/modules/facilities/query-defs.ts (new),
tests/db/facilities-queries.test.ts (new), src/app/api/v1/query/all-queries.ts (+1 import line),
tests/db/api-query-route.test.ts (+2 smoke sample lines)
Behavior implemented: facilities.assets {roomId?,status?} -> AssetRow[]; facilities.maintenanceRequests
{status?,limit?} -> MaintenanceRequest[] (asset ?? "General", location fallback chain, raised_at in
institution tz, assignee null when staff RLS hides it, sorted priority desc then raised_at desc). Both
gated on maintenance.request. Lane B: no `module` field (MOD unmerged, per header ruling).
Tests run: pnpm test:db tests/db/facilities-queries.test.ts tests/db/api-query-route.test.ts -> 2 files,
13 tests, all passed. pnpm lint -> clean. pnpm typecheck -> clean for touched files; pre-existing
errors in src/modules/lifecycle/actions.ts (not my packet, not touched) ignored per brief.
Tests not run and why: full test:db / db:reset / seed / db:types (brief: non-owner, own file only).
Limitations / honesty label: none — read-only queries, no UI/messages, no SimulatedBadge/LimitedBadge.
Security / integration risks: none new; relies on existing 0075 RLS (assets/maintenance_requests) and
staff_select (0004) for the assignee-hiding behavior; no new SQL.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: AssetListSchema/MaintenanceListSchema (T3's facilities/schemas.ts) match the EXPORTS
input shapes exactly, used as-is; teacherWorkload-style nested FK embed (assets(name,location,rooms(name)),
staff(full_name)) resolves via existing single FKs, same shape as timetable/queries.ts.
