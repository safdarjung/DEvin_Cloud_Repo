# F-UI-06 — Finance intelligence (`/fabric/finance-intel`)

Goal: collection forecast with band, outstanding alerts, budget vs actual, reminder drafts (vision §11.13, §15.1 school slice). Links to the real `/finance` pages for records.

## Files
- `src/app/(tenant)/[institution]/fabric/finance-intel/page.tsx`: loads `financeForecast`, `outstandingAlerts`, `budgetLines` from `@/modules/fabric/demo/finance-intel`. Money is paise → format with `inr` from `@/lib/format`.
- `src/modules/fabric/components/finance/forecast-chart.tsx` ("use client"): Recharts `ComposedChart`: bars = collected, line = expected, shaded `Area` between forecast_low/high for future months; legend; tooltip with INR; toggle "Show as table". Badge "Forecast from demo data — not a prediction of this school".
- `finance/outstanding-table.tsx`: table (student, section, outstanding INR, days overdue with severity, concession chip, last reminder); filters: >30 / >60 / >90 days, concession only; sort; row "Draft reminder" → `reminder-drawer.tsx`; bulk select → "Draft reminders (n)".
- `finance/reminder-drawer.tsx`: `Sheet` with an editable message template (en/hi toggle, placeholders filled from the row), "Copy" button, footer "Draft — not sent. Copy it to send yourself." No send button.
- `finance/budget.tsx`: category rows with budget vs actual bars and variance %, over-budget rows in warning colour; "Explain variance" → `Popover` with a fixed 1-line fixture reason per category (write 10 strings in the component).
- KPIs on top: collected this month, expected, outstanding total, concessions (`AnimatedNumber` + `inr`).

## Controls
Chart toggle → table. Filters → table. Draft reminder → drawer → copy. Bulk → drawer with list. Explain → popover. "Open ledger" → `/finance/ledger`, "Defaulters" → `/finance/defaulters` (real pages). Export → CSV of outstanding.

## Motion / states / responsive / a11y
Bars grow on mount; KPI count-ups. Empty filter → `EmptyState`. Mobile: chart height 240, table → cards. Chart has `sr-only` summary ("6 months collected, 6 forecast, band widens to ±x%").

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/finance-intel.test.ts`.

Commit `feat(ui): F-UI-06 finance intelligence — forecast, outstanding, budget, reminder drafts`. `DONE F-UI-06 <sha>`.
