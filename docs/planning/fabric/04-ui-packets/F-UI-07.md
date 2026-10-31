# F-UI-07 — Insights & early warning (`/fabric/insights`)

Goal: the insight-to-action experience of vision §13.1 and §7.6, with the Laya-routed visual variant. This is the showcase screen; polish it first.

## Files
- `src/app/(tenant)/[institution]/fabric/insights/page.tsx`: loads `insights`, `insightActions` from `@/modules/fabric/demo/insights`; reads `?id=&domain=&severity=`.
- `src/modules/fabric/components/insights/insight-list.tsx` ("use client"): left column list (severity icon, kind chip, title, confidence bar, status from `useDemoStore(s => s.insightStatus[id]) ?? insight.status`); filters domain/severity/kind/status; search; sort by severity then confidence.
- `insights/insight-detail.tsx`: right column (or `Sheet` on mobile). Sections in order: Pattern · Evidence (`useVisualRoute` picks variant: `chart` → Recharts bar of evidence, `table` → table, `text` → bullets; show "Routed locally by Laya" / "Default view" with source) · Sources + date range · Confidence (bar + plain sentence "about 7 in 10 similar patterns held") · Contributing factors (weights as horizontal bars, labelled "hypotheses, not causes") · Who should review (`reviewer_role`) · Recommended actions (checklist) · Approval (if `approval_required`: "Request approval" → status `reviewing` + banner) · Follow-up (actions from store for this insight: `recordInsightAction` form: action, owner, rationale, expected outcome) · Outcome (for actions with `measured_at`: expected vs actual; "Record outcome" → `measureOutcome`).
- `insights/evidence-variants.tsx`: the three renderers above; chart uses `@/components/chart` colours; table uses shadcn `Table`.
- `insights/entity-link.tsx`: `entity_ref` → link to the real page when one exists (`section` → `/attendance/<id>`, `student` → `/students/<id>`, `fee_structure` → `/finance/structures/<id>`), else to the Fabric workspace (`route` → `/fabric/operations?tab=transport`, `department` → `/fabric/twin`).

## Controls
List item → detail (URL `?id=`). Filters → list. Status buttons (Reviewing / Actioned / Resolved / Dismiss) → `setInsightStatus`. Request approval → status + banner. Record action → `recordInsightAction`. Record outcome → `measureOutcome`. Actions checklist → local ticks. Export → JSON of the insight. "Open in twin" → `/fabric/twin?focus=<entity id>`.

## Motion / states / responsive / a11y
Detail sections `Stagger`; variant swap cross-fades (CSS). Loading variant → `Skeleton` ≤300 ms. No insight selected → `EmptyState` "Pick an insight". Mobile: list full width, detail in `Sheet`. Confidence and severity have text equivalents; evidence chart has table toggle.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/insights.test.ts tests/unit/fabric-router.test.ts`. With the Laya bridge down the page still renders "Default view".

Commit `feat(ui): F-UI-07 insights — insight-to-action detail with Laya-routed evidence`. `DONE F-UI-07 <sha>`.
