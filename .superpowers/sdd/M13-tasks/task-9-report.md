Packet: M13-T9 Transport queries
Files changed: src/modules/transport/queries.ts, src/modules/transport/query-defs.ts (new); tests/db/transport-queries.test.ts (new); src/app/api/v1/query/all-queries.ts (+1 import line, append only); tests/db/api-query-route.test.ts (+2 sample-input lines, append only)
Behavior implemented: transport.routes (transport.manage) -> TransportRoute[] (vehicle/driver "" + capacity 0 when no vehicle, stops seq-ordered with per-stop/overall counts). transport.forStudent (student.read) -> StudentTransport|null, RLS-scoped. No `module:` field per Lane B ruling (MOD not merged here).
Tests run: pnpm test:db tests/db/transport-queries.test.ts tests/db/api-query-route.test.ts -> 2 files, 14 passed, 0 failed. pnpm lint (touched files) -> clean.
Tests not run and why: full pnpm test:db / db:reset / seed / db:types (brief: non-owner, own file only).
Limitations / honesty label: none added here (LimitedBadge is UI-layer, outside queries scope).
Security / integration risks: none found. Found+fixed: transport_assignments has two FK paths to transport_stops (stop_id, and composite (stop_id,route_id)); PostgREST embed was ambiguous — disambiguated with `transport_stops!stop_id(...)` hint.
Follow-ups: none new; UI wiring of this query (fixture replacement) is a later packet's job.
New dependencies: none.
Assumptions made: forStudent embeds vehicle via nested transport_routes->transport_vehicles (forward FK, 2-hop), mirrors codebase precedent (class_sections(name, grades(code))).
