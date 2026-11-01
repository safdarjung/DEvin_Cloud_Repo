Packet: T-034 Guardian portal shell composing lane components

Files changed:
- src/modules/people/queries.ts — added `ChildSummary`, `listMyChildren`, `getMyStudent` (+ shared `toChildSummary` mapper)
- src/modules/people/portal.ts (new) — `resolvePortalSelection` (cache()-wrapped), `listReceiptSummariesForStudent`
- src/modules/people/components/ChildSwitcher.tsx (new) — client component, `usePathname()`-based switcher links
- src/modules/people/components/PortalNav.tsx (new) — server component: switcher + tab nav, used by every portal page
- src/app/(tenant)/[institution]/portal/layout.tsx — rewritten (was the T-034 placeholder) to just ctx + `student.read` floor
- src/app/(tenant)/[institution]/portal/page.tsx — rewritten: overview tiles (attendance %, outstanding fees, latest result, open assignments)
- src/app/(tenant)/[institution]/portal/{attendance,fees,fees/receipts/[id],results,assignments,notifications}/page.tsx (new)
- tests/db/portal-scope.test.ts (new), e2e/j07-guardian-portal.spec.ts (new, not run)

Behavior implemented:
Guardian/student portal with 6 tabs (overview/attendance/fees/results/assignments/notifications), composing the five lane components unmodified. Child selection is `?student=<id>`, re-validated on every page via `resolvePortalSelection` (never trusted from the URL alone). Guardian gets a child switcher (hidden for ≤1 child or for the student role); student role gets no switcher, title "My school" vs guardian's "My children". Receipt view inside the portal reuses the exact `ReceiptView` component the accountant's own receipt page uses.

Deviation from the packet's literal `portal/layout.tsx` design — Next.js architecture constraint, not a choice:
Next.js layouts never receive a `searchParams` prop and don't rerender on query-param-only navigation (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` §"Query params" — confirmed by reading it per AGENTS.md's instruction to check Next 16.4 breaking-change docs before writing layout/searchParams code). Since the switcher and tabs depend on `?student=`, they can't live in `layout.tsx` as literally specified. Fix: `layout.tsx` stays thin (ctx resolution + the `student.read` permission floor only); the switcher+tabs moved into `PortalNav`, a server component each of the 6 `page.tsx` files renders for itself (each page already has `searchParams`). Net effect is the same UI the packet describes, just assembled one layer down.

Child selection scope proofs (file:line):
- `src/modules/people/portal.ts:28-41` `resolvePortalSelection` — student role: `getMyStudent(ctx)`, then `if (!me || (studentParam && studentParam !== me.id)) notFound()`. Guardian role: `listMyChildren(ctx)`, `studentParam ? children.find(...) : children[0]`, `if (!selected) notFound()`.
- Called fresh (via React `cache()`, deduped only within one request) at the top of every one of the 6 `page.tsx` files, immediately after that page's own `requirePermission` call — e.g. `src/app/(tenant)/[institution]/portal/results/page.tsx:20-22`.

Receipt scope proof (file:line):
- `src/app/(tenant)/[institution]/portal/fees/receipts/[id]/page.tsx:27-28` — `getReceipt(ctx, id)` then `if (!receipt || receipt.snapshot.studentId !== selection.studentId) notFound()`. RLS (`receipts_select`, `20261028000008_finance.sql:369-382`) already keeps a guardian from fetching another family's receipt at all; this re-check additionally stops a guardian viewing *a different one of their own children's* receipts through the wrong child's URL slot.

Per-tab permission proofs (file:line) — each calls its own `requirePermission` in addition to RLS, per packet rule 3:
- attendance: `portal/attendance/page.tsx:18` → `"attendance.read"`
- fees + receipt: `portal/fees/page.tsx:17`, `portal/fees/receipts/[id]/page.tsx:25` → `"finance.read"`
- results: `portal/results/page.tsx:19` → `"exam.result.read"`
- assignments: `portal/assignments/page.tsx:17` → `"assignment.read"`
- notifications: `portal/notifications/page.tsx:20` → `"notification.read"`
- overview + layout floor: `portal/page.tsx:23`, `portal/layout.tsx:19` → `"student.read"` (broadly held — any staff role reaching `/portal` directly still 404s in `resolvePortalSelection` since they have neither `guardianId` nor `studentId`)

`portal_access` behaviour (DBT-24, lead ruling 1):
`listMyChildren` (`src/modules/people/queries.ts`) filters `guardian_students.portal_access = true` — this is the *only* place that filter is applied. RLS helpers (`app.guardian_student_ids`, `app.my_student_ids`, `supabase/migrations/20261028000001_foundation.sql:178`, `20261028000020_rls_performance.sql:103`) do not check `portal_access` at all, so a guardian with `portal_access = false` for a child is excluded only from the portal's own child list/switcher — every RLS-scoped read (notifications, etc.) is unaffected, matching the ruling. Verified in `tests/db/portal-scope.test.ts`'s first test (visible/hidden children, `portal_access = true/false`).

Tests run:
- `pnpm vitest run --project db tests/db/portal-scope.test.ts` → 4 passed (listMyChildren portal_access filter + ordering; C-11/C-54 cross-guardian/cross-institution isolation; getMyStudent self-only; all four portal-tab read queries scoped to own child vs. another institution's child — RLS returns empty, never an error).
- `pnpm test` (unit project, includes `tests/unit/nav.test.ts` — untouched, lead-owned) → 320 passed, 30 files.
- `pnpm lint` → 0 errors (3 pre-existing warnings in `scripts/seed/sections/{admissions,exams,finance}.ts`, not mine).
- `pnpm typecheck` → clean for every file this packet touched; one pre-existing failure in `tests/db/rls-performance.test.ts` (P-01's uncommitted file, unrelated to T-034) — confirmed by re-running with and without my changes staged.

Tests not run and why:
- `pnpm test:e2e -- e2e/j07-guardian-portal.spec.ts` — explicitly told not to run E2E; written with a `GuardianPortalPage` page-object class (exported for T-041) covering AC1 (two children, switching), AC2 (cross-guardian 404), AC3 (student.one no switcher), AC5 (390×844, no console errors). AC4 (receipt match) isn't its own test — covered structurally by the portal receipt page reusing `ReceiptView` unmodified; a true pixel/text-diff against the accountant's page would need a payment fixture this spec doesn't create.
- Full `test:db`/`db:reset`/`seed` — not run, per the "another agent owns the DB" rule; only my own fixture-scoped file was run.

Limitations / honesty label:
No `<SimulatedBadge>`/`<LimitedBadge>` added — nothing in the portal is simulated or limited; it composes already-real lane components. "Request recheck" button on the results page is `disabled` with a "Coming soon (T-020)" tooltip, per the packet's own assumption (T-020 not built) — intentionally not a `<LimitedBadge>` since that would mislabel "not wired up yet" as "simulated".

Security / integration risks:
- `listReceiptSummariesForStudent` (`src/modules/people/portal.ts`) is a cross-module read of finance's `receipts` table done from the people module, because `finance/queries.ts` has no "receipts for a student" export and is uncommitted/mid-review (T-032) — CLAUDE.md rule 10 says don't touch it. It relies entirely on `receipts_select` RLS to pre-scope rows (finance roles or the receipt's own guardian/student); the `studentId` filter afterward is display narrowing, not a new auth boundary. Flagged here so it can be folded into `finance/queries.ts` once T-032 merges (see Follow-ups).
- `StudentInvoices`'s own invoice-row links go to `/finance/invoices/[id]` (outside `/portal`), which is already reachable by guardian/student today via `finance.read` + RLS (confirmed by reading that page) — no new write surface, but it does leave the portal's own chrome, a minor UX gap, not a security one.

Follow-ups:
- Fold `listReceiptSummariesForStudent` into `src/modules/finance/queries.ts` once T-032 lands (12 §Debt candidate).
- T-020 (recheck requests): wire the disabled button in `portal/results/page.tsx`.
- `StudentInvoices`'s invoice link could point at a portal-scoped invoice page instead of the staff route, if T-041 wants the guardian to never leave `/portal` chrome.

New dependencies (justification): none.

Assumptions made:
- "First child deterministically" = ascending `admission_no` (stable, unique, already used for per-student display elsewhere in this module).
- Overview tile "open assignments" = count of `listStudentAssignments` rows (that query already filters to `status = 'published'`; there's no separate "closed" distinction needed for the tile).
- Switching a child from the portal nav links to the *current* tab (not always back to overview) — implemented via `usePathname()` in `ChildSwitcher`, read as the more literal interpretation of AC1 ("switching changes every tab's data").

Fix round 1:
1. MED — moved the receipts-for-student read out of `people/portal.ts` (no longer a cross-module JS filter over every receipt) now that T-032 is committed. New `listReceiptsForStudent` in `src/modules/finance/queries.ts`: filters server-side via `payments!inner(invoice_id, invoices!inner(student_id))` + `.eq("payments.invoices.student_id", studentId)` (receipts has no `student_id` column itself), orders `created_at desc`, capped at `.limit(50)`. Deleted `listReceiptSummariesForStudent`/`ReceiptSummary` from `people/portal.ts` along with its now-unused `createClient` import; updated the one caller, `portal/fees/page.tsx`, to import from `finance/queries.ts` instead.
2. LOW — `portal/page.tsx` overview now calls `requirePermission` for all four tile permissions (`attendance.read`, `finance.read`, `exam.result.read`, `assignment.read`) in addition to the existing `student.read` floor, matching the per-tab pages.

Re-verified: `tests/db/portal-scope.test.ts` 4/4 pass, `pnpm test` 327/327 pass (31 files — up from 320/30, from other agents' concurrent commits, not this fix), `pnpm lint` 0 errors (same 3 pre-existing unrelated warnings). Typecheck not re-run this round (not in the allowed command list).

Fix round 2:

Root cause (systematic-debugging, Phase 1): visiting any portal URL without `?student=` (the bare `/portal`, or a tab link typed/bookmarked without it) resolved a default child server-side and rendered — but never put that id into the browser's URL. `ChildSwitcher`/`PortalNav`'s own links always include `?student=`, which is why this was invisible once already on a tab; it only showed on first landing, which is exactly what `e2e/j07-guardian-portal.spec.ts`'s AC1/AC2 land on. Confirmed by running the spec and reading `portal.currentStudentId()` (parses `?student=` from `page.url()`): it was `null` right after `goto()`.

Fix: `resolvePortalSelection` (`src/modules/people/portal.ts`) now takes a third `currentPath` argument and, when `studentParam` is absent, calls `redirect(`${currentPath}?student=<picked id>`)` instead of silently rendering — canonicalizing the URL on the first hit of any tab. Updated all 6 callers (`portal/{page,attendance/page,fees/page,fees/receipts/[id]/page,results/page,assignments/page,notifications/page}.tsx`) to pass their own path.

Recheck button: already fixed by Batch B/T-020 before this round started — `portal/results/page.tsx`'s old disabled placeholder button is gone (replaced with a comment), since `ReportCard` now renders its own working per-paper "Request recheck" affordance (`RecheckRequestForm`) for guardian/student. No change needed from me; `e2e/j11-recheck-request.spec.ts` passed on the first run this round.

Second bug, found while re-running the suite (own test code, not the app): AC1 then failed differently — a 30s timeout clicking `portal.childLink("Ishaan")`, a hardcoded name that's actually guardian.two's child, not guardian.one's; the `.catch()` fallback never got a chance to run because Playwright's `.click()` auto-wait burns the full action timeout before rejecting on a 0-match locator. Fixed by clicking the switcher's second link directly (no name guessing). That exposed a third, genuinely racy bit: `page.waitForLoadState("networkidle")` right after the click was not a reliable signal that the URL had updated (instrumented request/response events and `page.url()` — the RSC fetch for the new `?student=` completes well inside the networkidle window, but reading the URL immediately after it occasionally still showed the pre-click value). Replaced with `page.waitForURL()` on the clicked link's own href — waiting for the actual condition instead of a generic idle heuristic (`condition-based-waiting` technique).

Re-verified: `pnpm demo:reset` (full reseed), `pnpm test:e2e e2e/j07-guardian-portal.spec.ts e2e/j11-recheck-request.spec.ts` 5/5 pass, `pnpm test` 358/358 pass (32 files — up again from other agents' concurrent work), `pnpm lint` 0 errors (same 3 pre-existing unrelated warnings), `pnpm typecheck` clean (the previously-noted unrelated `tests/db/rls-performance.test.ts` failure is also gone — P-01 must have fixed it independently).
