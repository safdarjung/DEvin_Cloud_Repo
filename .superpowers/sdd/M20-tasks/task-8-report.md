Packet: M20-T8 Queries `mastery.heatmapBySection`, `mastery.gapsForStudent`

Files changed:
- `src/modules/mastery/queries.ts` (new) — `masteryHeatmap(ctx, {classSectionId?, subjectId?})`, `masteryGapsForStudent(ctx, studentId)`.
- `src/modules/mastery/query-defs.ts` (new) — `mastery.heatmapBySection` (`mastery.review`), `mastery.gapsForStudent` (`mastery.read`), both `module: "mastery"`.
- `src/app/api/v1/query/all-queries.ts` — added `mastery/query-defs` import line.
- `tests/db/api-query-route.test.ts` — added `mastery.heatmapBySection`/`mastery.gapsForStudent` smoke samples.
- `tests/db/mastery-queries.test.ts` (new) — 9 tests, all TEST FIRST cases.

Behavior implemented: `masteryHeatmap` resolves the current year, pages `mastery_heatmap` RPC (1000/page), then fetches section+grade/subject/unit names in separate RLS'd queries and sorts by grade sort_key, section name, subject name, unit sequence. `masteryGapsForStudent` reads the student's `mastery_snapshots` (own RLS), scopes to the year of the latest `computed_at` row, maps to `rules.ts` `UnitScore[]` and calls `gapsFrom`.

Tests run: `pnpm test:db tests/db/mastery-queries.test.ts` 9/9 pass; `pnpm test:db tests/db/api-query-route.test.ts` 7/7 pass; `pnpm lint` clean (0 errors; pre-existing warnings in other files untouched); `pnpm typecheck` clean.

Tests not run and why: `pnpm test:security` — not my task file, not run per brief (single-file DB rule; no full suite).

Limitations / honesty label: none new — `limited` badge lands with T15's UI pass (no UI here).

Security / integration risks: none new. Both functions are security-invoker RPCs; no definer bypass added. `mastery_heatmap`'s nullable uuid filter args are generated as non-null `string` in `types.ts` (pg_proc exposes no param nullability) — cast `as unknown as string` to pass a real `null`, commented in `queries.ts`.

Follow-ups: none new.

New dependencies: none.

Assumptions made: no partial T8 work existed in-tree at start (checked `src/modules/mastery/` — only T2/T3's `schemas.ts`/`rules.ts`); built fresh. Other agents' concurrent edits in this worktree (T7's `all-actions.ts`, `escalation.test.ts`, `exams/paper-units.actions.ts`) untouched and not reviewed — out of scope.
