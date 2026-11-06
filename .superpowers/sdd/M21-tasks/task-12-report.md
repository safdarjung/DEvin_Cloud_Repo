Packet: M21-T12 M21-T12 Docs

Files changed: 
- `docs/planning/coolskool/07-security-and-ai-governance.md` (§4 added M21 definer + invokers)
- `docs/planning/coolskool/06-workflows-and-contracts.md` (§7 added `forecast.run` job type)
- `docs/planning/coolskool/03-feature-matrix.md` (added F-INT-05 forecasting feature)
- `docs/planning/coolskool/12-decision-log.md` (§3 added 8 debt rows DBT-78..85)

Behavior implemented: 
- Documented M21 `public.enqueue_due_forecasts()` definer + `forecast_fee_series`/`forecast_attendance_series` invokers (07 §4)
- Documented `forecast.run` job type: payload `{as_of}`, idempotency key, replace semantics (06 §7)
- Added F-INT-05 forecasting feature (limited, P1) to feature matrix (03 §F)
- Added 8 debt rows for known M21 limitations: month/period rename, in-progress term 0 collected, toggle wait, no history, no admissions, class_section_id FK unconstrained, LimitedBadge pending, demo seed shortfall

Tests run: `pnpm lint` — clean (0 errors)

Tests not run and why: none required (docs only)

Limitations / honesty label: Feature status `limited` with label "baseline model, backtested MAPE shown" per rulings; label pending UI swap in Workstream D. Demo lacks 4 terms history for fee forecasts (M27 fabric seed provides it).

Security / integration risks: Module gating for `forecasts` is app-layer permission check (`forecast.read`), not a table gate — documented in debt DBT-63 pattern (applies to all optional modules). `class_section_id` not FK-constrained by table; mitigation: service-role-only writes with proven institution validation in SQL (invokers).

Follow-ups: DBT-78..85 (8 debt rows in decision log §3): period-name contract rename, forecast accuracy audit, admissions forecast as future feature, UI badge swap in Workstream D, demo seed backfill in M27.

New dependencies: none

Assumptions made: M21-T1..T11 already merged; migration 0094 already marked built in backlog index (10 §3).
