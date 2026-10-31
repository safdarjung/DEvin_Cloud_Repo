# F-UI-12 — Custom Studio (`/fabric/studio`)

Goal: vision §10 — request intake → AI interpretation → clarifying questions → proposal → agent pipeline → review → sandboxed preview → delivery. Interpretation is instant and local (`interpretRequest` heuristic), labelled as demo.

## Files
- `src/app/(tenant)/[institution]/fabric/studio/page.tsx`: loads `studioRequests`, `studioProposals` from `@/modules/fabric/demo/studio`; `?request=&from=`.
- `src/modules/fabric/components/studio/request-list.tsx` ("use client"): requests from `useDemoStore(s => s.requests)` as a status board (columns submitted · analysing · proposed · approved · building · review · delivered; rejected in a footer); card → detail. "New request" → wizard.
- `studio/request-wizard.tsx`: `Dialog` with 3 steps: Problem (title, problem, desired outcome) · Context (user roles multi-chip, existing systems, integrations, constraints) · Terms (budget range, timeline, success criteria). Submit → `submitRequest` (status `submitted`) then after 600 ms `setRequestStatus analysing`, then `interpretRequest(text)` → `saveProposal` with `resolution`, `interpretation`, `clarifying_questions`, default pipeline (all `pending`), cost/timeline from a small table by resolution (write it in the component) → `setRequestStatus proposed`. Each step validates required fields inline.
- `studio/request-detail.tsx`: tabs Request · Interpretation (resolution chip with the §10.2 ladder shown as 6 steps, highlighted one; clarifying questions as a form whose answers append to `notes` via `setNote`) · Proposal (features, workflows, UX outline, technical/integration/permission requirements, cost `inr`, timeline, risks, acceptance) · Pipeline · Preview · Delivery.
- `studio/pipeline-view.tsx`: `FlowCanvas` 7 stages left→right from `proposal.pipeline` (status colours, agent name under node); "Advance (demo)" → `advancePipeline` (moves the next stage to `done` with a 500 ms "running" state; at `security` show a review-findings card with 2 fixed findings; at `deploy` set request `delivered`). "Approve proposal" → `setRequestStatus approved` (principal/owner only; others see "Needs principal approval").
- `studio/preview-frame.tsx`: `<iframe sandbox="" srcDoc={proposal.preview_html} title="Module preview (static demo)">` only when `preview_html` is non-null; caption "Static preview — not generated at runtime". Never inject anything else.
- `studio/delivery.tsx`: version, "Install from marketplace" → `installModule` with a synthetic `MarketplaceModule`-like id `custom-<request id>` (store accepts any id), link to `/fabric/marketplace?module=custom-…`.

## Controls
New request → wizard → store. Board card → detail. Clarifying answers → notes. Approve → store. Advance → store. Preview → iframe. Install → store + navigate. Export → JSON of the proposal.

## Motion / states / responsive / a11y
Board cards move between columns with CSS transitions; pipeline nodes pulse while "running". Empty board → `EmptyState` + "New request". Mobile: board becomes a filterable list; pipeline canvas read-only with a step list. Wizard steps announce progress (`aria-current="step"`).

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/studio.test.ts tests/unit/fabric-store.test.ts`. `grep -rn dangerouslySetInnerHTML src/modules/fabric/components/studio` returns nothing.

Commit `feat(ui): F-UI-12 Custom Studio — intake, proposal, pipeline, sandboxed preview`. `DONE F-UI-12 <sha>`.
