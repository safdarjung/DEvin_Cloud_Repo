# F-UI-14 — Data & integrations (`/fabric/data`)

Goal: vision §6 — connectors with health, sync log, data-quality scores, lineage graph, import wizard.

## Files
- `src/app/(tenant)/[institution]/fabric/data/page.tsx`: loads `connectors`, `connectorSyncs`, `dataQualityScores`, `lineage` from `@/modules/fabric/demo/data`; `?tab=` Connectors · Quality · Lineage · Import.
- `src/modules/fabric/components/data/connectors.tsx` ("use client"): cards (provider icon from lucide by kind, name, kind chip, status with icon, last sync relative time, records synced, scopes as chips); "Sync now" → fake 1.2 s progress then appends a sync row in component state; "Disconnect" → confirm → status `disconnected` locally; "Connect new" → `Dialog` listing 6 future providers → each opens the labelled future-integration dialog. Simulated channels (WhatsApp, Razorpay) carry `SimulatedBadge` inline.
- `data/sync-log.tsx`: table (connector, started, duration, status, records, errors expandable); filter by connector/status; export CSV.
- `data/quality.tsx`: score cards per entity (ring 0–100, colour by band, issue chips with counts); click → `Sheet` with issue list and "Open records" → real page (`students` → `/students`, `invoices` → `/finance/invoices`, else none); "Run quality check" → fake progress then same data (toast "No changes — demo").
- `data/lineage-canvas.tsx`: `FlowCanvas` from `lineage()` with `nodeTypes` per `LineageNode.type` (source/table/metric/report/widget shapes); click node → highlight upstream/downstream (compute by BFS over edges in component); side panel lists them; search by label.
- `data/import-wizard.tsx`: 3 steps: Upload (accept `.csv`, parse first 20 rows client-side with a tiny splitter, no library) · Map columns (selects per detected column → target fields of a chosen entity: students/guardians/staff) · Validate (show counts: valid/missing/duplicate from simple rules) → "Import (demo)" → toast + append to `notes` (`setNote data:lastImport`). Nothing is written anywhere else.

## Controls
Sync/Disconnect/Connect → local or future-integration dialog. Filters/export → table/CSV. Quality card → sheet → real page. Lineage click → highlight. Wizard → local parse → note.

## Motion / states / responsive / a11y
Status icons pulse for `degraded`; progress bars animate. No connectors → `EmptyState`. Mobile: cards one column, lineage 60vh + node list. File input has a label; wizard steps `aria-current`.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/data.test.ts tests/unit/flow-from-spec.test.ts`.

Commit `feat(ui): F-UI-14 data & integrations — connectors, quality, lineage, import wizard`. `DONE F-UI-14 <sha>`.
