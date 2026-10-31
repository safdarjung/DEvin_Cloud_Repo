# F-UI-11 — Marketplace (`/fabric/marketplace`)

Goal: vision §9 — catalogue, discovery, module detail, lifecycle (install/approve/disable/uninstall/upgrade) persisted in the demo store, compatibility and permissions shown honestly.

## Files
- `src/app/(tenant)/[institution]/fabric/marketplace/page.tsx`: loads `marketplaceModules`, `initialInstalls` from `@/modules/fabric/demo/marketplace`; `?category=&q=&module=`.
- `src/modules/fabric/components/marketplace/catalogue.tsx` ("use client"): header search + category chips (all 10 `ModuleCategory`) + filters (price model, supported product, "installed only"); sections Featured · New releases (`released_at` last 60 days) · Popular (`installs_count`) · All; card = name, vendor, category, one-line summary, rating stars (text equivalent), price (`inr` or Free/Usage/Custom), install state button.
- `marketplace/module-detail.tsx`: `Sheet` (or route param view on desktop) with tabs Overview (description, intended roles, supported products) · Requirements (required permissions as chips compared against the current member's permissions from `ctx` — show ✓/✗; required integrations compared against `connectors` from `@/modules/fabric/demo/data`; dependencies with their install state) · Pricing · Versions (changelog list) · Reviews ("No reviews yet — demo catalogue").
- `marketplace/install-button.tsx`: state machine from `useDemoStore(s => s.installs)`: not installed → "Install" (if any requirement ✗ → "Request approval" → `installModule` with `status:"pending_approval"`); pending → "Awaiting approval" (principal role sees "Approve" → `setInstallStatus installed`); installed → menu Disable / Uninstall / Upgrade (if `version` < module.version) → `setInstallStatus` / `uninstallModule` / `installModule` new version. Confirm dialog on uninstall. Toast on each change.
- `marketplace/installed-panel.tsx`: "Installed (n)" drawer listing installs with config form (key/values from `config`) → `installModule` with new config.

## Controls
Search/filters → grid (URL-synced). Card → detail. Install/Approve/Disable/Uninstall/Upgrade → store. Config save → store. "Suggest a module" → `/fabric/studio?from=marketplace`. Export → CSV of installed.

## Motion / states / responsive / a11y
Cards `Stagger`; install button morphs state with a 200 ms cross-fade; detail tabs animate with `LayoutPill`. No results → `EmptyState` with "Clear filters". Mobile: 1 column, detail full-height sheet. Rating has `aria-label="4.5 out of 5"`; requirement ✓/✗ have text.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/marketplace.test.ts tests/unit/fabric-store.test.ts`. Refresh keeps installs.

Commit `feat(ui): F-UI-11 marketplace — catalogue, detail, install lifecycle`. `DONE F-UI-11 <sha>`.
