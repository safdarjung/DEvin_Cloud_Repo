Packet: M20-T14 Acceptance over HTTP

Files changed: `tests/db/mastery-acceptance.test.ts` (new)

Behavior implemented: real `/api/v1/actions` + `/api/v1/query` dispatch (real bearer tokens, real RLS), mirrors `timetable-acceptance.test.ts`/`exam-seating-acceptance.test.ts`. Flow: exam_controller `exam.paper.setUnits` 200 on section A's maths paper; section C's paper mapped directly (service role, proves teacher exclusion only); marks inserted for fixture student + A2 (gap, 30%) and C1 (no gap, 80%); `masteryCompute` job handler run directly as service role (compute + detector, no HTTP surface exists for the job); student `mastery.gapsForStudent` self → gaps, other student → `[]` (RLS-empty, not error); guardian own child → gaps; teacher `mastery.heatmapBySection` → section A present, section C absent; accountant same query → 403 `forbidden`; `insertGapPlan` + class teacher `mastery.intervention.update` proposed→active → 200; admin same id → 404 `not_found` (RLS hides non-owner/principal/non-class-teacher). Separate test: mastery module off → 403 `MODULE_DISABLED_MESSAGE`. Separate describe: demo tenant (`st-josephs-demo`, service role, read-only) — Aarav Sharma's Maths unit-1 snapshot score/confidence match T13's formula, verifying the already-seeded, already-computed data (no reset/reseed run).

Tests run: `pnpm test:db tests/db/mastery-acceptance.test.ts` 3/3 pass; `pnpm lint` 0 errors (11 pre-existing warnings, all in files not mine: `src/lib/nav.ts`, `src/modules/fabric/components/fabric-sections.tsx`, `tests/unit/mastery-schemas.test.ts`); `pnpm typecheck` clean.

Tests not run and why: none — all packet ACCEPT commands ran.

Limitations / honesty label: none new — no UI surface in this task; `limited` badge lands with T15.

Security / integration risks: none new; test-only, dispatches through the real action/query guards (module→schema→permission) already shipped by T1–T13. Confirms the 404-vs-403-vs-empty-array distinctions the rulings specify (RLS-hidden row vs. permission-denied vs. RLS-narrowed read).

Follow-ups: none new.

New dependencies: none.

Assumptions made: "run masteryCompute as service role" = call the job handler directly (no HTTP surface for `mastery.compute` exists, matching T12's own test pattern) rather than going through the runner; section C's paper unit mapping done via direct SQL (not the HTTP action) since the packet names exactly one `exam.paper.setUnits` HTTP call and C's data exists only to prove heatmap exclusion.
