# F-UI-15 — Trust & governance (`/fabric/trust`)

Goal: vision §2.4 and §17 — real permission matrix, audit timeline, consent and retention, model registry with cost, permission reviews.

## Files
- `src/app/(tenant)/[institution]/fabric/trust/page.tsx`: loads `auditEvents`, `modelRegistry`, `consentRecords`, `permissionReviews` from `@/modules/fabric/demo/trust`; imports `PERMISSIONS` and `Role` from `@/lib/auth/permissions` (real matrix); `?tab=` Roles · Audit · Consent · Models · Reviews.
- `src/modules/fabric/components/trust/permission-matrix.tsx` ("use client"): roles as columns, permissions as rows grouped by prefix (`student.*`, `exam.*`…), ✓ cells from the real matrix; search; hover a permission → tooltip with the actions that require it (hardcode a short map for 10 common keys); "This matrix is live — it is what the app enforces today" `LimitedBadge` (not Simulated) on this tab only.
- `trust/audit-timeline.tsx`: `ActivityTimeline` (widgets) over `auditEvents`; filters actor role/event prefix/date; event click → `Popover` with summary; export CSV. Link "Real audit log" → `/jobs` for now (note in packet: real audit UI is Phase 2).
- `trust/consent.tsx`: table (user, subject, purpose, granted switch → component state with confirm, expires); retention policy cards (students 7y after leaving, AI chats 90 days, audit 10y — fixed demo text) with "Request change" → labelled future-integration dialog.
- `trust/models.tsx`: registry table (provider, model, tier local/cloud, version, cost per 1k in/out `inr`, p50 latency, eval score, status); "Routing policy" card explaining local-first (links to `/ai/usage`, real page); "Prompt-injection posture" card listing the 4 defenses the app already has (delimited data blocks, redaction, allowlisted tools, human approval) each with a link to `docs/planning/coolskool/07-security-and-ai-governance.md` anchor text.
- `trust/reviews.tsx`: permission review queue (member, role, extra permissions chips, due, status); "Mark reviewed" / "Revoke extra" → component state with toast; "Start review cycle" → sorts due first and shows a progress bar.

## Controls
Search/filters → tables. Consent switch → local with confirm. Reviews actions → local. Export → CSV audit. Links → real pages/docs.

## Motion / states / responsive / a11y
Matrix cells fade by row; sticky header and first column. Empty filter → `EmptyState`. Mobile: matrix scrolls horizontally with a role picker alternative (one role at a time). ✓ cells have `aria-label="teacher can attendance.mark"`.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/trust.test.ts`. Matrix row count equals `Object.keys(PERMISSIONS).length`.

Commit `feat(ui): F-UI-15 trust & governance — live permission matrix, audit, consent, models, reviews`. `DONE F-UI-15 <sha>`.
