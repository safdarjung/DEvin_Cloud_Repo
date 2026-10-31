# F-UI-03 — Learning & academics (`/fabric/learning`)

Goal: mastery heatmap, curriculum coverage, assessment planner, assignment-create demo (vision §11.6, §11.10, §13 ws 2).

## Files
- `src/app/(tenant)/[institution]/fabric/learning/page.tsx`: server loads `masteryCells`, `curriculumCoverage`, `assessmentPlan` from `@/modules/fabric/demo/learning`.
- `src/modules/fabric/components/learning/mastery-heatmap.tsx` ("use client"): sections × topics grid per subject (subject `Tabs`), cell colour by `mastery_pct` (5 steps, pattern + number for a11y), click → side `Sheet` with cell detail (`students_below_threshold`, "Plan intervention" → navigates `/fabric/students?section=…&topic=…`). Filters: subject tab, threshold slider (default 60), "weak spots only".
- `learning/coverage-table.tsx`: table (section, subject, planned vs completed as progress bar, on-track chip); sort by column; export CSV.
- `learning/assessment-planner.tsx`: month strip with items; "Add assessment" opens a `Dialog` (title, subject, section, date, kind) → appends to local component state (not persisted; say so in the dialog footer "Demo only — saved for this session"); status chips.
- `learning/assignment-demo.tsx`: "Create assignment" `Sheet` (title, section, due date, objective) → on save shows the created item in a "Recent" list and a `Callout` "Saved to demo state" using `dispatch({type:"setNote", key:"learning:lastAssignment", value})`.

## Controls
Heatmap cell → sheet. Threshold slider → recolour. Export → CSV of coverage. Add assessment → dialog → list. Create assignment → sheet → recent list + note. All headers link back to `/assignments` and `/exams` (real pages).

## Motion / states / responsive / a11y
Heatmap cells fade in by row (`Stagger`), hover scale 1.02. Empty subject → `EmptyState`. Mobile: heatmap scrolls horizontally with sticky first column; planner becomes a list. Cells are `<button>`s with `aria-label="VII-A Fractions 48%"`.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/learning.test.ts`. Light/dark, 360/1280.

Commit `feat(ui): F-UI-03 learning workspace — mastery heatmap, coverage, planner`. `DONE F-UI-03 <sha>`.
