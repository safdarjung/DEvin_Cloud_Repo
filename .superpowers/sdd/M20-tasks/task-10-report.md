Packet: M20-T10 Action `mastery.intervention.update`

Files changed: `src/modules/mastery/actions.ts` (new); `tests/db/mastery-intervention-actions.test.ts` (new); `src/app/api/v1/actions/all-actions.ts` (+1 import line); `tests/security/escalation.test.ts` (+1 C-03 fixture).

Behavior implemented: `defineAction` reads the row by id+kind='intervention' (RLS) → `not_found` if none; patches only given fields (`goal`,`steps`,`review_date`,`intervention_status`) via `.update().select()`; 0 rows → `not_found`; SQL errors via `mapSqlError` (guard_intervention's `code:invalid_state`/`code:validation_failed`, RLS `42501`→forbidden); audits `mastery.intervention.updated {id, from, to}` (status values only); returns `{id, status}`.

Tests run: `pnpm test:db tests/db/mastery-intervention-actions.test.ts` 6/6 pass; `pnpm test tests/unit/action-names-unique.test.ts` 6/6 pass; `pnpm test:security tests/security/escalation.test.ts` 1542/1542 pass; `pnpm lint` (4 files) clean; `pnpm typecheck` clean.

Tests not run and why: none — all ACCEPT commands ran.

Limitations / honesty label: none new — `limited` badge lands with T15.

Security / integration risks: none new. Thin RLS pass-through; T6's trigger/RLS do the real enforcement. Patch typed `TablesUpdate<"insight_actions">` (not a loose `Record`) so a stray column can't slip through.

Follow-ups: none new.

New dependencies: none.

Assumptions made: no partial T10 work existed in-tree at start (checked `src/modules/mastery/` — only T2/T3/T8's files); built fresh. Placed the manifest import alphabetically (lifecycle→mastery→notifications) and the C-03 fixture next to T7's `exam.paper.setUnits` entry (same module family); exact object order is non-functional in both files.
