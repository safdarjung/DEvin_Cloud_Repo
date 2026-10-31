# F-UI-13 — Personal AI (`/me`)

Goal: vision §2.2–2.3 and §14 — a visibly separate personal workspace: memory inspector (view/correct/delete/export), goals, workspace switcher, and the "leaving the institution" boundary demo.

## Files
- `src/app/(tenant)/[institution]/me/page.tsx`: loads `personalMemories(opts, ctx.user.id)`, `personalGoals(opts, ctx.user.id)`, `workspaces(opts)` from `@/modules/fabric/demo/personal`. Header is **different** from tenant pages: `FabricPage` with `ws="me"` renders a "Personal workspace" eyebrow, the user's name, and no institution name; `SimulatedBadge` stays.
- `src/modules/fabric/components/me/workspace-switcher.tsx` ("use client"): segmented control Personal · St Joseph's (institution) · Household; switching to institution navigates to `/dashboard`; Household shows an `EmptyState` "Household workspace is a future product" (vision §1.2).
- `me/assistant-panel.tsx`: a chat-shaped panel with 4 preset prompts ("Plan my week", "Summarise my goals", "What did I ask the school AI about?" → answer: "Nothing from the school workspace is visible here — contexts are separate.", "Export my memory"); each preset renders a fixed response card from the fixtures (no model call); footer "Demo responses — Personal AI model runs locally in a later phase".
- `me/memory-inspector.tsx`: table from `useDemoStore(s => s.memories)`: kind chip, content (inline editable → `upsertMemory`), source (user/inferred with icon), shared-with-institution switch (→ `upsertMemory`), retain-until date, delete (confirm → `deleteMemory`); filters by kind/source; "Export memory" → `downloadFile("my-memory.json", JSON)`; "Add memory" dialog.
- `me/goals.tsx`: goal cards with progress ring (from tasks done), tasks checklist → `toggleTask`, "New goal" dialog → `upsertGoal`.
- `me/boundary-demo.tsx`: "What happens if I leave St Joseph's?" button → `Dialog` showing `boundaryPreview(memories)`: two columns Stays with me · Revoked, plus the note; "Simulate leaving" → applies: `upsertMemory` for stays (flag cleared), `deleteMemory` for revoked, toast "Institution access revoked (demo)"; "Undo" restores from a snapshot kept in component state.

## Controls
Switcher → navigate/empty. Presets → fixed cards. Memory edit/toggle/delete/add/export → store/file. Tasks/goals → store. Boundary → dialog → store, undo.

## Motion / states / responsive / a11y
Panel cards `FadeIn`; progress rings animate. Empty memory → `EmptyState` "Nothing remembered yet". Mobile: single column, inspector rows → cards. Inline edits have Save/Cancel buttons (no blur-save); switches have labels.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/personal.test.ts tests/unit/fabric-store.test.ts`. Refresh keeps edits; `/me` link visible to teacher and principal, hidden to guardian/student (nav test covers).

Commit `feat(ui): F-UI-13 Personal AI workspace — memory inspector, goals, boundary demo`. `DONE F-UI-13 <sha>`.
