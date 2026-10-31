# F-UI-01 — Fabric shell: wrapper, role switcher, download helper, skeleton polish

Goal: every Fabric route shares one wrapper, the demo user can switch roles in two clicks, and the sidebar/command palette feel finished before any workspace lands.

## Files
- `src/modules/fabric/components/fabric-page.tsx` (server-safe): `FabricPage({ title, description, ws, actions?, children })` → `PageHeader` + `<SimulatedBadge />` + optional header actions + `<DemoStoreControls />`; export `startOfToday(): Date` (UTC midnight of today).
- `src/modules/fabric/components/demo-store-controls.tsx` ("use client"): small popover with "Reset demo data" (`dispatch({type:"reset"})` after a confirm dialog), "Export demo state" (`exportJson` → `downloadFile("fabric-demo.json", …)`), "Import" (file input → `parseImport` → `dispatch({type:"importState", state})`, show `ErrorState` inline on invalid).
- `src/modules/fabric/components/download.ts`: `downloadFile(name, text, mime)`, `toCsv(rows: Record<string, unknown>[]): string` (quotes, commas, newlines escaped).
- `src/modules/fabric/components/fabric-provider.tsx` ("use client"): mounts once per tenant page tree; calls `initDemoStore(seed)` with `seed` props built by the server (installs from `initialInstalls`, scenarios from `scenarios`, requests/proposals from `studioRequests`/`studioProposals`, workflows from `workflows`, memories/goals from `personalMemories`/`personalGoals`, interventions from `interventionPlans`, layouts from `defaultWidgetOrder` per role). Wire it in `src/app/(tenant)/[institution]/layout.tsx` **only** by adding the provider around `{children}` (CLAIM the layout on the channel first; one-line change).
- `src/components/tenant/user-menu.tsx`: add "Switch demo role" submenu (owner, principal, admin, admissions, accountant, exam_controller, teacher, student, guardian) visible only when `is_demo`; each item posts the existing demo-login form the login page uses (see `e2e/j00b-demo-login-buttons.spec.ts` and `src/app/(auth)/login` for the exact action) and lands on `homePathFor`.
- Sidebar: "Fabric" group gets a subtle section label and an `Sparkles` icon tint; "Personal" group sits last. Command palette: confirm all 13 Fabric items are searchable (nav-derived) and add synonyms ("twin" ↔ "digital twin", "studio" ↔ "custom module").
- Replace the 13 placeholder bodies' paragraph with a `Skeleton` layout matching each workspace's first screen (3 KPI cards + 1 chart + 1 list) so the shell looks alive before packets land. Keep the "arrives in packet" sentence under the skeleton.

## Controls and what they do
Reset → confirm dialog → store reset → toast "Demo data reset". Export → file download. Import → parse → replace. Switch role → re-login as that demo user. Section labels → none (static).

## Motion / states / responsive / a11y
`FadeIn` on page body (CSS, visible in SSR). Popover and dialog via shadcn. Mobile: controls collapse into the header kebab menu. Role switcher items have `role="menuitemradio"` with the current role checked.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric` · `pnpm test:e2e -- e2e/tenant-shell.spec.ts` · open `/st-josephs-demo/fabric/insights` as principal: badge visible in SSR HTML (`curl -s … | grep -c Simulated`).

Commit `feat(ui): F-UI-01 Fabric shell, role switcher, demo store controls`. Done signal `DONE F-UI-01 <sha>`.
