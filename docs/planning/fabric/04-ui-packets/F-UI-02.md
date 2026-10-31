# F-UI-02 — Command centre (dashboard v3)

Goal: `/dashboard` becomes the role-adaptive command centre of vision §12 — brief, priorities, forecasts, risks, approvals, rearrangeable widgets with a saved layout.

## Files
- `src/app/(tenant)/[institution]/dashboard/page.tsx`: keep the existing real-data KPIs and sections; add the Fabric block below the greeting. Server computes `dailyBrief(opts, role)`, `priorityActions(opts)`, `forecastCards(opts)`, `riskIndicators(opts)`, `insights(opts).slice(0,4)`, `defaultWidgetOrder(role)` and passes them to the client grid. Role = `ctx.membership.role` mapped to `principal|teacher|guardian|student` (owner/admin/admissions/accountant/exam_controller → principal brief).
- `src/modules/fabric/components/command/command-grid.tsx` ("use client"): widget grid driven by `useDemoStore(s => s.layouts[role]) ?? defaultOrder`. Native HTML5 drag-and-drop between cards (`draggable`, `onDragStart/Over/Drop`), "Customise" toggle shows handles + hide/show per widget; `dispatch({type:"setLayout", role, order})` on drop. Keyboard: in customise mode, each card has "Move up/down" buttons.
- Widgets (new, under `src/modules/fabric/components/command/`): `daily-brief.tsx` (headline, items as links; footer "Generated from demo data"), `priority-actions.tsx` (severity icon + text + why on hover, "Open" → href, "Done" hides for the session), `forecast-cards.tsx` (`AnimatedNumber`, direction arrow, confidence bar, unit-aware via `inr` for paise), `risk-indicators.tsx` (level chips → `/fabric/insights?id=`), `insight-peek.tsx` (`AIInsightCard` × 4 → `/fabric/insights`). Reuse `ApprovalsWidget`, `StaffAvailabilityWidget`, `TimetableWidget`, `TrendWidget` for the rest with existing demo fixtures from `src/modules/core/demo/fixtures.ts`.

## Controls
Customise → drag/hide/reorder → saved. Reset layout → `setLayout` with default. Brief item → navigate. Priority "Open" → navigate; "Done" → local state. Forecast card → `/fabric/insights?domain=…`. Risk chip → insight detail. Role variants: teacher sees Today-style timetable + class insights; guardian/student see their portal subset (brief + risks only, no finance).

## Motion / states / responsive / a11y
`Stagger` cards; `LayoutPill`-style highlight on the dragged card; reduced-motion respected. Empty layout (all hidden) → `EmptyState` with "Show all". Mobile: one column, drag disabled, move buttons only. Each card `role="region"` `aria-label`.

## Checks
Existing `e2e/j13-dashboard.spec.ts` stays green (greeting + count-ups unchanged). Refresh keeps order. `pnpm typecheck && pnpm lint`.

Commit `feat(ui): F-UI-02 command centre with brief, priorities, forecasts, rearrangeable widgets`. `DONE F-UI-02 <sha>`.
