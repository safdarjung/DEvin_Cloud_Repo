# F-UI-05 — School operations (`/fabric/operations`)

Goal: timetable conflict detector, teacher workload, substitution planner, transport map, facilities + maintenance (vision §11.7, §11.14, §11.15).

## Files
- `src/app/(tenant)/[institution]/fabric/operations/page.tsx`: loads `timetableConflicts`, `teacherWorkloads`, `transportRoutes`, `maintenanceRequests`, `roomUtilisation` from `@/modules/fabric/demo/operations`.
- `src/modules/fabric/components/operations/operations-tabs.tsx` ("use client"): `Tabs` Timetable · Staff · Transport · Facilities, tab in `?tab=` search param.
- `operations/conflicts.tsx`: list grouped by day; each conflict card shows kind icon, entities, suggestion; "Apply suggestion" marks it resolved in component state with an undo toast; "Open timetable" → `/today` (real). Summary KPIs on top (`KpiWidget`): conflicts, teachers over load, rooms >90%.
- `operations/workload.tsx`: horizontal bar per teacher (periods/week vs max, over-load in warning colour), sort by load, subject chips; click → `Popover` with sections + leave dates; "Plan substitution" → `substitution-dialog.tsx`: pick date + absent teacher → list 3 available teachers (not on leave, under max) → "Assign" → toast + row note "Substitute: …" (component state).
- `operations/transport-map.tsx`: inline SVG 100×100 viewBox, polyline per route, stop circles sized by students, status colour + icon; route list on the side; click route → highlight + stops table with ETA; "Notify parents of delay" → labelled future-integration dialog (channel is simulated, DBT-01).
- `operations/facilities.tsx`: room utilisation grid (cards, utilisation bar) + maintenance table (priority chip, status select → component state, assignee `Select`); "New request" `Dialog` → appends.

## Controls
Tab → URL. Apply suggestion → resolved + undo. Plan substitution → dialog → assign. Route → highlight. Notify → future-integration dialog. Status select → local. New request → dialog → table. Export → CSV of maintenance.

## Motion / states / responsive / a11y
Map polylines draw in with `stroke-dasharray` animation (CSS, `motion-safe`). Bars animate width on mount. Mobile: map stacks above list; tables → cards. SVG has `<title>` per route and a text table alternative.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/operations.test.ts`.

Commit `feat(ui): F-UI-05 operations — conflicts, workload, transport map, facilities`. `DONE F-UI-05 <sha>`.
