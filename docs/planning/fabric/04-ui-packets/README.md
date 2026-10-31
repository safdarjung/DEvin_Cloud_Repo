# UI packets — shared conventions (read once, then only your packet)

Repo `schoolversee/schoolverse`, branch `main` only. Before each packet: `git pull --rebase`. After: `pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric` green → commit `feat(ui): F-UI-nn <title>` → `git push` → post `DONE F-UI-nn <sha>` on ntfy. Blocked → post `BLOCKED F-UI-nn <≤3 lines>` and move to the next packet.

## You own / you never touch
- **Edit:** `src/app/(tenant)/[institution]/fabric/**/page.tsx`, `src/app/(tenant)/[institution]/me/page.tsx`, `src/app/(tenant)/[institution]/dashboard/page.tsx`, `src/modules/fabric/components/**`, `src/components/widgets/**`, `src/components/tenant/user-menu.tsx` (F-UI-01 only), `e2e/*fabric*`.
- **Read only:** `src/modules/fabric/types.ts` (row types), `src/modules/fabric/demo/*.ts` (fixtures), `src/modules/fabric/store/*` (demo store), `src/modules/fabric/spec/schemas.ts` + `src/lib/genui/*` (Canvas renderer, FlowCanvas), `src/components/**` (shell, widgets, ui, motion, states, honesty). Contract gap → `BLOCKED`, never a local workaround.
- No new dependencies. No `localStorage` in components. No `dangerouslySetInnerHTML`. No `fetch` except the Laya hook already provided.

## Page pattern (every workspace)

```tsx
// src/app/(tenant)/[institution]/fabric/<ws>/page.tsx  (server component; copy the placeholder already there)
const ctx = await getTenantContext(institution);            // as the placeholder does
requirePermission(ctx, "dashboard.view");
const now = startOfToday();                                  // deterministic: fixtures must match on server and client
const opts = { now, institutionId: ctx.institution.id };
const rows = someFixture(opts);                              // from src/modules/fabric/demo/<ws>.ts
return (
  <FabricPage title="…" description="…" ws="<ws>">        // F-UI-01 wrapper: PageHeader + <SimulatedBadge/> + store reset
    <WorkspaceClient rows={rows} />                          // "use client" component in src/modules/fabric/components/<ws>/
  </FabricPage>
);
```

- Fixtures are pure and deterministic (`seed` default 7). Call them in the server page and pass props down; never call them in effects.
- Mutable demo state (installs, scenarios, proposals, layouts, memory…) comes from the demo store: `const installs = useDemoStore(s => s.installs); dispatch({ type: "installModule", … })`. The store hydrates from `localStorage` after mount and exposes `hydrated`; render fixture-derived defaults until then so SSR markup never mismatches.
- `startOfToday()` lives in `src/modules/fabric/components/fabric-page.tsx` (F-UI-01). Use it everywhere.

## Components to reuse (import paths)
`@/components/page-header` `PageHeader` · `@/components/honesty` `SimulatedBadge`, `LimitedBadge` · `@/components/states` `EmptyState`, `ErrorState`, `LoadingState` · `@/components/motion` `FadeIn`, `Stagger`, `StaggerItem`, `AnimatedNumber`, `LayoutPill` · `@/components/widgets/*` (`KpiWidget`, `TrendWidget`, `ListWidget`, `ActivityTimeline`, `ApprovalsWidget`, `StaffAvailabilityWidget`, `TimetableWidget`, `AIInsightCard`, `QuickActions`, `Widget`) · `@/components/chart` + Recharts · `@/components/ui/*` (shadcn: Button, Card, Dialog, Sheet, Tabs, Table, Select, Input, Textarea, Badge, Tooltip, Popover, Skeleton, Toaster/sonner) · `@/lib/genui/canvas-renderer` `CanvasRenderer({spec,onAction})` · `@/lib/genui/flow-canvas` `FlowCanvas({nodes,edges,onNodeClick,readOnly})` via `next/dynamic` `{ssr:false}` · `@/lib/genui/flow-from-spec` `flowFromSpec` · `@/modules/fabric/router/use-visual-route` `useVisualRoute` · `@/lib/format` `inr`, `humanize` · `lucide-react` icons.

## Design bar (vision §19.1)
Premium, calm, dense-but-breathing. Cards with 1px borders, 12–16px radius, muted backgrounds, one accent per severity (`info/watch/warning/critical` → blue/amber/orange/red via existing tokens). Light + dark (tokens only, no hex). Entrance: `FadeIn`/`Stagger` (CSS-driven, SSR-visible). Numbers: `AnimatedNumber`. Mobile: single column ≤640px, tables become stacked cards, sheets full-height. Every list has empty/loading states; every async-looking action (Laya route, "run") shows a skeleton ≤300 ms, never a spinner-only screen.

## Accessibility bar
Every control has a visible label or `aria-label`; focus ring visible; dialogs trap focus (shadcn does); icons decorative `aria-hidden`; severity never conveyed by colour alone (icon + text); charts have a text summary (`<p className="sr-only">`) and a table toggle.

## Honesty (rule 7)
`<FabricPage>` renders `<SimulatedBadge />` in the header. Anything labelled AI shows "Routed locally by Laya" or "Default view" from `useVisualRoute().source`, and "Generated from demo data" on briefs. Future integrations open a dialog titled "Demo of a future integration" with one sentence on what the real version would do.

## Exports
"Export" buttons build a real file from props: `new Blob([csv], {type:"text/csv"})` + `URL.createObjectURL` + `<a download>`. Helper `downloadFile(name, text, mime)` goes in `src/modules/fabric/components/download.ts` (F-UI-01).

## Checks before DONE
`pnpm typecheck` · `pnpm lint` · `pnpm test -- tests/unit/fabric` · open the page as `principal` (seeded demo login) in light and dark, 360px and 1280px · refresh keeps store state · every button does one of the §19.5 actions.
