Packet: T-028 Enrolment action + UI + student profile page

## Phase 1

Files changed:
- src/modules/admissions/schemas.ts (EnrolApplicantSchema)
- src/modules/admissions/actions.ts (enrolApplicant)
- src/modules/admissions/queries.ts (listSectionsForGrade)
- src/modules/admissions/components/EnrolDialog.tsx (new)
- src/modules/admissions/components/ApplicationDetail.tsx (wired EnrolDialog, replaced placeholder)
- src/app/(tenant)/[institution]/admissions/applications/[id]/page.tsx (fetches sections/fee structures when canEnrol)
- src/modules/finance/queries.ts (added listInvoicesForStudent)
- src/modules/people/queries.ts, src/modules/people/components/{StudentProfile,StudentProfileHeader,GuardiansCard}.tsx (new)
- src/app/(tenant)/[institution]/students/page.tsx, students/[studentId]/page.tsx (new)
- tests/db/enrol-action.test.ts (new), e2e/j05-enrol.spec.ts (new, not run)
- src/lib/nav.ts: unchanged — `/students` + `student.read` already present (lead had added it); nav.test.ts already expects it and passes.

Behavior: enrolApplicant validates applicationId+classSectionId belong to ctx.institution (not_found), calls public.enrol_applicant, maps capacity→conflict / invalid_state via mapSqlError, and maps the roll_no unique-violation (23505) to a friendly `conflict` instead of leaking as `internal`. Returns `{ studentId, admissionNo, invoiceId, alreadyEnrolled }`. EnrolDialog shows section (active/capacity, disables full ones), fee structure (default marked), optional roll no; submit disabled while pending (double-submit safety); success panel shows admission no, `<LimitedBadge/>` "Guardian login invite not yet available", links to student profile/invoice. Student pages: `/students` (search by name/admission no via ilike, paginated 50) and `/students/[id]` (guardians, section, roll no, attendance %, invoices with a `<LimitedBadge/>` "full term" note; report cards omitted — T-019's ReportCard doesn't exist in this tree).

Permission/scope proofs:
- enrolApplicant: permission "admissions.enrol"; applicationId/classSectionId re-verified against ctx.institution.id before the RPC.
- /students, /students/[id]: requirePermission(ctx,"student.read") then explicit `role === "student" || "guardian"` → notFound() — packet explicitly wants guardians/students blocked here even though the matrix's student.read row scopes them ("s"); portal (T-034) is their path instead.
- getStudentProfile re-checks studentId belongs to ctx.institution.id.

Error mapping: not_found (cross-tenant ids), conflict (capacity + roll_no 23505), invalid_state (non-accepted application), forbidden (permission check, teacher role) — verified by tests/db/enrol-action.test.ts (8 cases).

RLS vs matrix findings (not fixed in phase 1 — migrations were out of scope then):
1. CRITICAL for J-05: fee_structures_select RLS was app.finance_roles() = owner/principal/admin/accountant — excluded "admissions", the real J-05 persona. Fixed in phase 2 (migration 0019).
2. Same shape, lower severity: invoices_select RLS excludes "admissions" too (finance.read matrix row) — left as-is (by design, documented).
3. DBT-17 (pre-existing): not re-investigated, reported only.

Tests run (phase 1): `pnpm vitest run --project db tests/db/enrol-action.test.ts` → 8/8; `pnpm test` → 296/296; `pnpm exec eslint` on touched files → clean; `pnpm exec tsc --noEmit` (whole project) → 0 errors.

## Phase 2

Scope: lead ruling to own the DB (db:reset/demo:reset/seed/db:types), fix the fee_structures RLS gap found in phase 1, fix two review findings, debug and fix a j03/j04 e2e regression, and re-run the full verification matrix.

### 1. Migration 20261028000019_fee_structures_admissions_read.sql

Drops/recreates `fee_structures_select` to also allow `admissions` SELECT (table-qualified: `fee_structures.institution_id`). Read-only — insert/update stay `finance_roles()`-only. Checked whether EnrolDialog needs `fee_components` too: no — `listFeeStructures`'s embedded `fee_components(count)` still returns 0 for admissions (unchanged RLS there), but EnrolDialog never renders `componentCount`, so `fee_components` was left untouched (grant only what's actually read). `invoices`/`invoice_lines` stay excluded for admissions (finance.read matrix), unrelated to this fix.

- Recorded in `docs/planning/coolskool/10-backlog-index.md` §3.
- `tests/security/rls-expectations.ts`: `fee_structures.read` now includes `"admissions"`.
- New test `tests/db/finance.test.ts` ("0019: admissions can read fee_structures in its own institution, 0 rows for another tenant's") — positive own-tenant read, 0 rows cross-tenant (the generic C-01 suite already covered the cross-tenant case for every RLS_EXPECTATIONS table×role; this adds the positive-read half, which no generic test checks).
- `e2e/j05-enrol.spec.ts` switched from `admin@demo.coolskool.test` to `admissions@demo.coolskool.test` (the real demo step 5 persona), now that the RLS gap is fixed.

### 2. Code review fixes

- **MEDIUM** `people/queries.ts`: `escapeIlike` only handled ILIKE wildcards (`%`/`_`/`\`), not PostgREST's `.or()` filter-string syntax, which splits on `,`/`(`/`)`. A search like "Smith, John" 500'd. Added `quoteOrValue()` (double-quotes the value per PostgREST's own quoting rule, escaping `\`/`"` first) and applied it to the built term. Added `tests/db/students-search.test.ts`: a comma ("Smith, John"), parens ("A(B)"), and a literal `%`/`_` term — each proven to both not crash and match correctly.
- Also wrapped `listStudents` in `/students/page.tsx` in try/catch; a query error now shows an inline message and an empty table instead of crashing the page.
- **LOW** `finance/queries.ts`: extracted `toInvoiceSummary(row)`, used by `listInvoices`, `listInvoicesForStudent`, and `getInvoice` (previously copied 3×).

### 3. j03/j04 e2e regression — root cause and fix

Root cause (systematic-debugging, evidence from the dev server's own log, `/tmp/next-dev-manual2.log`): Next 16.4's dev server (Turbopack) builds one "server actions" loader module **per route**, re-evaluating the whole shared source file's top level for every route that reaches any export from it (the `"use server"` directive is file-granular, not per-export). `src/modules/admissions/actions.ts` is reached from two different routes — `/admissions` (updateEnquiryStatus) and `/admissions/applications/[id]` (decideApplication, and now enrolApplicant) — so its top level, including every `defineAction()` call, runs once per route against the single process-wide `registry` Map in `src/lib/actions/registry.ts`. The second route's re-run hit `registerAction`'s hard throw ("Action \"admissions.enquiry.status\" is already registered.") — a legitimate re-registration of the same name from the same source, not a real naming collision — which 500'd whichever page rendered second. Confirmed by direct log inspection: both routes loaded fine on their first-ever hit in this server's lifetime; the throw fired only once a second route's loader re-ran the same file.

This is shared infra (`src/lib/actions/registry.ts`, owned by T-008, not T-028, and not something a "spec assumption changed" fix could reach) — flagged here rather than silently patched blind. Fix applied (2 lines): `registerAction` now returns early if the name is already registered instead of throwing. No current test depends on the throw — the real "no two actions share a name" check (C-03) is T-042's and isn't built yet; when it lands, it should be a static check over the registered set, not a load-time throw incompatible with Turbopack's per-route re-evaluation.

Verified: `pnpm test:e2e e2e/j03-pipeline.spec.ts e2e/j04-decision.spec.ts` → both pass, unmodified, no weakened assertions.

### 4. Second bug found via e2e (my own files, not infra)

`e2e/j05-enrol.spec.ts`'s first run still failed after the registry fix: the dialog's success panel ("Enrolled — admission …") never appeared. Root cause: `enrolApplicant`'s `revalidatePath` triggers Next's automatic refetch of the current page once the action resolves; the application's status flips `accepted` → `enrolled` in that refetch. `ApplicationDetail.tsx` gated **mounting** `EnrolDialog` on `application.status === "accepted"`, so the moment enrolment succeeded, the dialog unmounted — taking its local `success` state (the very confirmation the user just produced) with it. Fix: `EnrolDialog` now always mounts; it takes an `enabled` prop and only its internal early-return (`if (!enabled && !success) return null`) depends on status, so `success` set by the click that caused the status flip survives the refetch. `ApplicationDetail.tsx` now always renders `<EnrolDialog enabled={canEnrol} .../>` instead of conditionally mounting it.

Also fixed in the same pass: `e2e/j05-enrol.spec.ts` used hardcoded guardian phones, which collided with leftover rows from an earlier failed run against the persistent demo DB (no `demo:reset` between runs) and made the C-21 guardian-reuse assertion flaky (3 links instead of 2). Switched to the same `uniquePhone()` pattern already used in j03/j04.

Verified: `pnpm demo:reset` then `pnpm test:e2e e2e/j03-pipeline.spec.ts e2e/j04-decision.spec.ts e2e/j05-enrol.spec.ts` → 4/4 pass.

### Commands run (phase 2)

- `pnpm db:reset` → clean, migration 0019 applied without error, seed complete.
- `pnpm db:types` → ran as part of db:reset's own script + rerun explicitly; no diff against HEAD — 0019 only changes an RLS policy (no new table/column/function signature), which `supabase gen types` doesn't reflect, so there's nothing for it to add.
- `pnpm vitest run --project db tests/db/enrol-action.test.ts tests/db/admissions-actions.test.ts tests/db/finance.test.ts tests/db/students-search.test.ts` → 30/30 pass.
- `pnpm test:security` → 465/465 pass (includes the generated C-01 cross-tenant check for fee_structures×admissions).
- `pnpm test:db` (full) → 32 files, 222/222 pass.
- `pnpm test` (unit) → 27 files, 296/296 pass.
- `pnpm lint` → 0 errors (4 pre-existing warnings in T-029 seed stubs, untouched).
- `pnpm demo:reset` → clean.
- `pnpm test:e2e e2e/j03-pipeline.spec.ts e2e/j04-decision.spec.ts e2e/j05-enrol.spec.ts` → 4/4 pass (after the registry + EnrolDialog fixes).

### Deviations / scope note

`src/lib/actions/registry.ts` is outside T-028's normal file ownership (T-008's); changed anyway because the regression's root cause lives there and the fix is a 2-line, behavior-preserving relaxation (idempotent re-registration instead of a hard throw), not a redesign. Flagging for lead awareness and for T-042 to pick a load-time-safe way to re-add the "no duplicate action names" check when the real C-03 suite is built.

### Files changed (phase 2, in addition to phase 1)

- supabase/migrations/20261028000019_fee_structures_admissions_read.sql (new)
- docs/planning/coolskool/10-backlog-index.md §3 (migration record)
- tests/security/rls-expectations.ts (fee_structures.read += admissions)
- tests/db/finance.test.ts (new RLS test)
- src/modules/people/queries.ts (quoteOrValue fix)
- src/app/(tenant)/[institution]/students/page.tsx (try/catch around listStudents)
- tests/db/students-search.test.ts (new)
- src/modules/finance/queries.ts (toInvoiceSummary extraction)
- src/lib/actions/registry.ts (idempotent registerAction — shared infra, see Deviations)
- src/modules/admissions/components/EnrolDialog.tsx, ApplicationDetail.tsx (always-mounted dialog fix)
- e2e/j05-enrol.spec.ts (admissions login, uniquePhone)
- src/lib/db/types.ts: unchanged — 0019 is RLS-only, no schema/function signature change for `supabase gen types` to pick up.
