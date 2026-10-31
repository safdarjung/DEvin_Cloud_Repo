# F-UI-04 — Student success (`/fabric/students`)

Goal: roster with risk, profile drawer, support queue (restricted), intervention plans persisted in the demo store (vision §11.10–11.11, §13 ws 3). AI never decides: the UI shows signals for staff review.

## Files
- `src/app/(tenant)/[institution]/fabric/students/page.tsx`: loads `studentSuccessRows`, `interventionPlans` from `@/modules/fabric/demo/success`; reads `?section=&topic=&risk=` search params for initial filters.
- `src/modules/fabric/components/success/roster.tsx` ("use client"): searchable table (name, section, attendance %, mastery %, trend arrow, risk chip, support owner, last contact); filters: section `Select`, risk chips, "has gaps"; sort; export CSV; row click → drawer.
- `success/student-drawer.tsx`: `Sheet` with header (name, section, risk), tabs Progress (mastery + attendance mini `TrendWidget` from the row's numbers), Gaps (list with "Suggest practice" → opens a `Dialog` "Demo of a future integration: practice recommendations"), Interventions (plans for this student from `useDemoStore(s => s.interventions)`; "New plan" → editor).
- `success/intervention-editor.tsx`: form (owner, goal, 3–5 steps with due dates, review date) → `dispatch({type:"saveIntervention", plan})`; steps toggle done via the same intent; status select proposed/active/review/closed. Banner "Restricted record — counsellor and principal only" with `Lock` icon (fixture `restricted: true`).
- `success/support-queue.tsx`: cards for `risk === "support"` sorted by attendance asc; "Assign owner" → `Select` of staff names from `teacherWorkloads` (import from `@/modules/fabric/demo/operations`) → stored on the plan.

## Controls
Search/filter/sort → table. Row → drawer. New plan → editor → store. Step toggle → store. Export → CSV. "Suggest practice" → labelled future-integration dialog. "Message guardian" → navigates `/notifications` (real page) with a toast "Draft only — nothing sent".

## Motion / states / responsive / a11y
Rows `Stagger`; risk chip pulses once on load for `support`. Empty filters → `EmptyState`. Mobile: cards instead of table; drawer full height. Table has `<caption>`; chips are `<button aria-pressed>`.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/success.test.ts`. Refresh keeps plans.

Commit `feat(ui): F-UI-04 student success — roster, drawer, interventions`. `DONE F-UI-04 <sha>`.
