Packet: MOD-T4 `core.module.set` + `core.modules.list`
Files changed: src/modules/core/actions.ts, src/modules/core/query-defs.ts, src/modules/core/queries.ts (new), tests/db/core-modules.test.ts (new), tests/security/escalation.test.ts, tests/db/api-query-route.test.ts
Behavior implemented: `setModuleEnabled` (core.module.set) — core key -> invalid_state; enabling with unmet `requires` -> conflict; disabling with an enabled dependent -> conflict; disabling `website` while live -> conflict; else patches `settings.modules`, audits, revalidates. `listModules(ctx)` — pure 11-category projection of MODULES + FEATURE_CATALOG options, no DB.
Tests run: pnpm test:db tests/db/core-modules.test.ts tests/db/core-actions.test.ts tests/db/api-query-route.test.ts -> 19 passed; pnpm test:security tests/security/escalation.test.ts -> 1062 passed; pnpm test tests/unit/action-names-unique.test.ts -> 4 passed; pnpm lint -> clean; pnpm typecheck -> clean on touched files.
Tests not run and why: full test:db/test:security/db:reset per DB-owner fence (not DB owner this task).
Limitations / honesty label: none; not a UI-facing feature.
Security / integration risks: none new — same permission/audit/module-gate pattern as `setFeatureEnabled`; `website` live check reuses `getWebsite` (website module's own queries.ts).
Follow-ups: T5 (`/settings/modules` page) consumes `listModules`/`setModuleEnabled` next.
New dependencies: none.
Assumptions made: basic-disable test used `assignments` (no requires/dependents) instead of `timetable`, since `timetable` has a default-on dependent (`substitution`) — that exact conflict is its own test case. Pre-existing `requireModule` TS errors in admissions/exams/website pages (concurrent T7/T8 work-in-progress, not T4 files) are untouched and reported, not fixed.
