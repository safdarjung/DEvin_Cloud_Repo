# F-UI-09 — School digital twin (`/fabric/twin`)

Goal: vision §8 — a React Flow graph of the school with entity drawer, change-impact overlay, historical/current/scenario states, forecast overlay. Not a diagram: every node carries capacity/load from the fixture.

## Files
- `src/app/(tenant)/[institution]/fabric/twin/page.tsx`: loads `twinSnapshot(opts, "historical"|"current"|"scenario")` ×3 from `@/modules/fabric/demo/twin`; reads `?focus=&scenario=&state=`.
- `src/modules/fabric/components/twin/twin-canvas.tsx` ("use client"): `FlowCanvas` via `next/dynamic` (`ssr:false`, loading = skeleton 480px) with custom `nodeTypes` from `twin/nodes.tsx`: one component per `TwinNodeType` (icon, label, utilisation ring, capacity/load caption; colour by utilisation ≤80 ok / ≤100 watch / >100 critical). Edge labels = relation. `readOnly` (pan/zoom only). `onNodeClick` → drawer + impact overlay.
- `twin/state-toggle.tsx`: segmented control Historical · Current · Scenario (+ scenario picker from `useDemoStore(s => s.scenarios)` when Scenario; applies the scenario's `enrolment_delta_pct` as a uniform load multiplier client-side on top of the scenario snapshot — say "illustrative" in a caption).
- `twin/entity-drawer.tsx`: `Sheet`: node facts, connected nodes grouped by relation (click → focus), "Show impact" → `changeImpact(snapshot, id)` → overlay highlights affected nodes (severity colours) + list with effect text; "Open record" → real page when type is `student_group` (`/attendance`) or `teacher` (`/students` for now) else nothing (hide button).
- `twin/legend.tsx`: node types + utilisation scale; filter chips by type (hide/show).
- `twin/forecast-overlay.tsx`: toggle "Forecast" → caption badges on rooms/routes with +Δ% from `forecastCards` (import from `@/modules/fabric/demo/command`) — labelled "demo forecast".

## Controls
State toggle → swap snapshot (fitView). Node click → drawer. Show impact → overlay. Type filters → hide nodes. Forecast toggle → badges. Search box → focus node by label. "Open simulator" → `/fabric/simulator`. Export → JSON of the current snapshot.

## Motion / states / responsive / a11y
Snapshot swap: nodes cross-fade (React Flow handles position; wrap canvas in `FadeIn` keyed by state). Impact overlay pulses once. Mobile: canvas 60vh, drawer full height, legend collapsible. Keyboard: a node list (`<ul>`) under the canvas mirrors nodes for screen readers and keyboard focus (click = same handler).

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/twin.test.ts tests/unit/flow-from-spec.test.ts`. Canvas renders nothing on the server (no hydration warnings in console).

Commit `feat(ui): F-UI-09 digital twin canvas with impact overlay and states`. `DONE F-UI-09 <sha>`.
