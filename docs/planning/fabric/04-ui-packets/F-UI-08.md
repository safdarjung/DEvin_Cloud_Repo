# F-UI-08 — What-if simulator (`/fabric/simulator`)

Goal: vision §7.5 — assumptions, baseline vs scenario, sensitivity, confidence band, save/compare, approval gate. The model is pure and local (`runScenario`), so every slider move recomputes instantly.

## Files
- `src/app/(tenant)/[institution]/fabric/simulator/page.tsx`: loads `scenarios(opts)` (baseline + 4) from `@/modules/fabric/demo/simulator`; passes `BASELINE_FACTS`.
- `src/modules/fabric/components/simulator/simulator.tsx` ("use client"): three-column layout — Assumptions · Results · Scenarios.
- `simulator/assumptions-panel.tsx`: sliders (shadcn `Slider` if present in `src/components/ui`, else `<input type="range">` styled): enrolment Δ% (−20…+30), staff Δ (−10…+15), fee change % (−10…+25), cost change % (−5…+20), periods/day (6–9), horizon months (6–24). Each shows value, a one-line "what this means" caption, and reset-to-baseline. Debounce 50 ms → `runScenario`.
- `simulator/results-panel.tsx`: Recharts `LineChart` revenue vs cost per month (baseline dashed, scenario solid) with confidence band (`Area` ±confidence pct); KPI strip: 12-month revenue, cost, margin %, peak utilisation, teacher load (deltas vs baseline with arrows); risk flags as chips with icon; "Sensitivity" table from `sensitivity(a)` (param, revenue Δ%, cost Δ%) sorted by |revenue Δ|.
- `simulator/scenario-list.tsx`: saved scenarios from `useDemoStore(s => s.scenarios)`; "Save as…" `Dialog` (name, rationale) → `saveScenario`; load → sets sliders; delete → `deleteScenario` (confirm); compare → pick 2 → `compare-view.tsx` side-by-side KPIs + both lines on one chart.
- Approval gate: "Propose for approval" → `saveScenario` with `status:"proposed"` + banner "Awaiting principal approval — nothing changes until approved" ; principal role sees Approve/Reject (`saveScenario` with new status). Disclaimer under the chart, verbatim: "A scenario based on assumptions is not proof that an intervention will produce this outcome."

## Controls
Sliders → live recompute. Reset → baseline. Save → store. Load/Delete/Compare → store/UI. Propose/Approve/Reject → store status. Export → CSV of monthly results. "Open in twin" → `/fabric/twin?scenario=<id>`.

## Motion / states / responsive / a11y
Lines animate on change (Recharts `isAnimationActive`, 300 ms); KPI deltas `AnimatedNumber`. No saved scenarios → `EmptyState` "Save your first scenario". Mobile: panels stack, assumptions in a collapsible. Sliders have `aria-valuetext` with units.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-simulator.test.ts tests/unit/fabric-store.test.ts`. Refresh keeps saved scenarios.

Commit `feat(ui): F-UI-08 what-if simulator with scenarios, sensitivity, approval gate`. `DONE F-UI-08 <sha>`.
