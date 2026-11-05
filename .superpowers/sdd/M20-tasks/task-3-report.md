Packet: M20-T3 Mastery rules — thresholds, risk, trend, proposal

Files changed:
- `src/modules/mastery/rules.ts` (new) — constants, Trend/Risk/MasteryGap/MasteryStats/UnitScore types, masteryPct, gapsFrom, trendFrom, classifyStudent, gapSeverity, gapConfidence, gapEvidence, gapPattern, proposeIntervention. Pure, only `import type … from "../fabric/types.ts"`.
- `tests/unit/mastery-rules.test.ts` (new) — 25 tests covering every TEST FIRST case.

Behavior implemented: all exports per rulings (Thresholds/Gap detector/Interventions). gapsFrom filters confidence>=0.5 & score<0.6, sorts score/subject/sequence. trendFrom uses last two chronological points, ±5 delta. classifyStudent risk (support/watch/none) + flag order exact. gapSeverity/gapConfidence/gapEvidence/gapPattern per spec, Overall-mastery entry omitted when meanScore null. proposeIntervention: k=min(3,gaps), UTC day arithmetic, singular "unit"/"gap unit".

Tests run: `pnpm lint`, `pnpm typecheck` → clean for my files (pre-existing errors only in other packets' `tests/unit/fee-plans-schemas.test.ts`, `tests/unit/timetable-suggest.test.ts`, warnings in `tests/unit/mastery-schemas.test.ts` — not touched, named per BRIEF-COMMON).

Tests not run and why: `pnpm test tests/unit/mastery-rules.test.ts` — this lane's globalSetup (`tests/setup/global.ts`) requires `SUPABASE_DB_URL` reachable even for the `unit` project; no DB stack runs here (per lane rules). Fails with a pre-existing Vite/postgres sourcemap crash (`code.charCodeAt is not a function`), reproduced identically on the already-merged `tests/unit/mastery-schemas.test.ts` — confirmed infra-only, documented precedent in `.superpowers/sdd/M25-tasks/task-1-report.md` and `10-backlog-index/T-041-report.md`. Verified logic instead via `node --experimental-strip-types` running every TEST FIRST assertion directly against `rules.ts`: all match (masteryPct, gap thresholds, trend, flag order, severity, propose steps +7/+14/+21/+28).

Limitations / honesty label: none (pure logic, no UI).

Security / integration risks: none — no DB, no I/O, no AI.

Follow-ups: none new. Flag CI/local-unit-only DB requirement for `10-backlog-index.md`/`12-decision-log.md` if not already tracked.

New dependencies: none.

Assumptions made: gapPattern always says "units" (not singularized) per literal ruling template; evidence label truncated to 120 chars via slice (no ellipsis, none of the test cases need it).
