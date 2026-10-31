# F-UI-16 — Polish: search, exports, tour, mobile and a11y pass

Goal: the whole Fabric surface feels like one product (vision §19) and the demo narrative runs end to end.

## Files / work
- Command palette (`src/components/tenant/command-palette.tsx`): add a "Fabric" group with deep links: every insight title (from `insights()` passed by the layout provider seed), every marketplace module name, every scenario name, every agent name; typing "install", "simulate", "approve", "twin" surfaces the matching workspace action.
- Exports: audit every workspace has a working export (CSV/JSON) using `downloadFile`; file names `fabric-<ws>-<yyyy-mm-dd>.<ext>`.
- Demo tour: `src/modules/fabric/components/tour/tour.tsx` — a "Take the tour" button in the dashboard header opens a 9-step guided overlay (one card per differentiator from vision §22, each with "Go" → the workspace with the relevant `?id=`/`?tab=`); progress dots; dismissible; state in component (not persisted).
- Mobile pass: open every Fabric route at 360×740 (Playwright `responsive.spec.ts` viewport): no horizontal scroll, tap targets ≥40px, sheets scroll, canvases 60vh.
- A11y pass: run `e2e/a11y.spec.ts` extended with the 13 Fabric routes (add them to its route list); fix every serious/critical axe finding; colour contrast on severity chips in dark mode.
- Honesty audit: `grep -rn "SimulatedBadge\|LimitedBadge" src/app/(tenant)/[institution]/fabric src/app/(tenant)/[institution]/me` shows every page; model/AI mentions carry "Routed locally by Laya"/"Default view"/"Generated from demo data".
- `e2e/j16-fabric-tour.spec.ts`: login as principal → dashboard tour → insights (`?id=ins-0001`) → request approval → simulator save scenario → twin focus → marketplace install → studio new request → `/me` export memory; assert store persistence after `page.reload()` in two places. Mock nothing; Laya may be down (assert "Default view" or "Routed locally" either way).
- Update `docs/planning/coolskool/08-testing-and-acceptance.md` journey list with J-16 (one row) and `e2e/demo-narrative.spec.ts` if it enumerates routes.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric` · `pnpm test:e2e -- e2e/j16-fabric-tour.spec.ts e2e/a11y.spec.ts e2e/responsive.spec.ts e2e/tenant-shell.spec.ts`.

Commit `feat(ui): F-UI-16 Fabric polish — palette deep links, tour, exports, mobile and a11y pass`. `DONE F-UI-16 <sha>`.
