Packet: F-UI-11 Marketplace (`/fabric/marketplace`) — live-fabric lane "marketplace"

Files changed:
- `src/app/(tenant)/[institution]/fabric/marketplace/page.tsx` — removed `PlannedWorkspace`; now loads the real catalogue for every institution (demo or not).
- `src/modules/fabric/marketplace.queries.ts` (new) — `marketplaceCatalog(ctx)` delegates to `core/queries.ts#listModules` (no duplicated module data).
- `src/modules/fabric/components/marketplace/catalogue.tsx` (new) — search, category chips, installed-only filter, CSV export of installed, card grid, opens `ModuleDetail`.
- `src/modules/fabric/components/marketplace/module-detail.tsx` (new) — Sheet with Overview (category, sub-feature toggles) + Requirements (permission check, dependency enabled state) tabs.
- `src/modules/fabric/components/marketplace/install-button.tsx` (new) — wraps the existing `setModuleEnabled` action; non-holders of `institution.settings.manage` see "Ask an administrator" instead of a button.
- `tests/unit/fabric-marketplace.test.ts` (new) — unit test for `marketplaceCatalog`.

Behavior implemented:
- Catalogue = real module catalog (`src/lib/modules/catalog.ts`, `MODULE_KEYS`/`MODULES`/`requires`), grouped by its real `ModuleCategory`. Installed state = `isModuleEnabled(ctx, key)` (via `listModules`), not a store.
- Install/Disable = existing `setModuleEnabled` action (permission `institution.settings.manage`); core modules show "Always on" (non-togglable, matches `/settings/modules`). Errors from the action (e.g. unmet `requires`, dependents still on) surface inline.
- Requirements tab shows the one real permission gate (`institution.settings.manage`, ✓/✗ against the caller) and each `requires` dependency with its live enabled state (✓/✗). No per-module permission matrix exists in this codebase beyond that single gate, so I did not invent one.
- No vendors, prices, ratings, install counts, versions/changelog, or reviews: omitted entirely rather than invented (none of that data exists for real modules).
- "Approval" flow: non-admins see "Ask an administrator" text, no fake pending-approval state.
- Export installed → CSV (key, label, category) via the existing `downloadFile`/`toCsv` helper.

Tests run:
- `pnpm test tests/unit/fabric-marketplace.test.ts tests/unit/fabric-fixtures/marketplace.test.ts tests/unit/nav-fabric.test.ts tests/unit/modules-catalog.test.ts` → 4 files, 65 tests passed.
- `pnpm lint` → 0 errors, 11 warnings (all pre-existing, in files outside this lane: `src/lib/nav.ts`, `src/modules/fabric/components/fabric-sections.tsx`, `tests/unit/mastery-schemas.test.ts`).
- `pnpm typecheck` → clean.
- `grep -rn dangerouslySetInnerHTML` on the new components → no matches.
- `pnpm dev --port 3104` + `curl .../fabric/marketplace` → HTTP 200, page renders "Marketplace" with no error boundary text.

Tests not run and why: `pnpm test:db` / `pnpm test:security` — this lane has no migration and no new action/table (reuses `core.module.set`, already in `tests/security/escalation.test.ts` and not DB-schema-touching), so no new DB/security fixtures were needed.

Limitations / honesty label: no `<LimitedBadge>` needed — every control shown reflects a real capability (real catalog, real toggle, real permission check). The "Ask an administrator" copy for non-admins is factual, not a badge-worthy limitation.

Security / integration risks: none new — reuses the existing `setModuleEnabled` action's permission and `requires`/dependents guards unchanged; no new table, no new action, no new RLS surface.

Follow-ups: none filed. If a later packet needs a richer "why" per permission requirement (per-module, not just the single install gate), that needs a new catalog field — not invented here.

New dependencies (justification): none.

Assumptions made: "required permissions vs caller's real permissions" (packet F-UI-11) maps to the one real permission gate this codebase has for module lifecycle (`institution.settings.manage`), since there is no per-module permission list in `MODULES`. Marketplace page shows real data for demo and non-demo institutions alike (brief says "no fixtures ... as the source of truth"); the demo-tenant fixture generator `src/modules/fabric/demo/marketplace.ts` and its test are left untouched (still used by `fabric-seed.ts` for other demo-store purposes, out of this lane's scope). No URL-sync for search/category filters (client state only) — kept scope to the data-source swap the brief asked for; can be added later if deep-linking a filtered view is needed.
