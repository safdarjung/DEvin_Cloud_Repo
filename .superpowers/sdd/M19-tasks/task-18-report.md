Packet: M19-T18 Queries insights.list, insights.actions
Files changed: src/modules/insights/queries.ts (new), src/modules/insights/query-defs.ts (new), tests/db/insight-queries.test.ts (new), src/app/api/v1/query/all-queries.ts (+1 import), tests/db/api-query-route.test.ts (+2 smoke samples)
Behavior implemented: listInsights (filters status/domain/limit, created_at desc, batched student/staff label lookup under caller RLS, fallback "Student"/"Staff member"); listInsightActions (current rows only, decided_at asc); insights.list/insights.actions defs, permission insight.read, module insights.
Tests run: pnpm test:db tests/db/insight-queries.test.ts -> 4 passed; pnpm test:db tests/db/api-query-route.test.ts -> 7 passed; pnpm lint -> clean; pnpm typecheck -> clean
Tests not run and why: full test:db (DB-owner rule, single-file only)
Limitations / honesty label: none; insights carry no honesty badge (real detections, per rulings)
Security / integration risks: none new; RLS (0092) does all narrowing, query adds institution_id filter in depth; permission check denies guardian/student before any DB call
Follow-ups: none
New dependencies: none
Assumptions made: explanation present always carries explanation_provider/model/explained_at together (T3 writer invariant, not re-validated here)
