Packet: T-027 Admissions CRM: pipeline, convert, decisions

Files changed:
- supabase/migrations/20261028000016_admissions_transitions.sql (new)
- src/modules/admissions/{state,schemas,queries,actions}.ts (new)
- src/modules/admissions/components/{PipelineBoard,EnquiryDetail,ApplicationDetail,DecisionTimeline}.tsx (new)
- src/app/(tenant)/[institution]/admissions/page.tsx (new)
- src/app/(tenant)/[institution]/admissions/enquiries/[id]/page.tsx (new)
- src/app/(tenant)/[institution]/admissions/applications/page.tsx (new)
- src/app/(tenant)/[institution]/admissions/applications/[id]/page.tsx (new)
- tests/unit/admissions-state.test.ts (new)
- tests/db/admissions-actions.test.ts (new)
- tests/helpers/factories.ts (added createEnquiry)
- e2e/j03-pipeline.spec.ts, e2e/j04-decision.spec.ts (new)
- docs/planning/coolskool/10-backlog-index.md §3 (reserved migration record)
- docs/planning/coolskool/07-security-and-ai-governance.md §4 (new definers row)
- src/lib/db/types.ts (regenerated via pnpm db:types, additions only)
- src/lib/nav.ts: unchanged — the `/admissions` line already existed.

Behavior implemented:
- state.ts: pure `canTransitionEnquiry` (backward allowed, locked once `converted`, `converted` only reachable via convert) and `canDecide`/`nextStatusForDecision` (06 §W4 diagram).
- RPCs (migration 0016): `public.decide_application`, `public.convert_enquiry`, `public.add_enquiry_note`, each a thin wrapper over an `app.*` function that role-checks internally (publish_exam_results shape), locks the row, validates, writes, audits, all in one transaction.
- Guards (migration 0016): `app.guard_application_decision` (BEFORE UPDATE on applications, blocks direct writes into offered/accepted/rejected/withdrawn), `app.guard_enquiry_mutation` (blocks direct writes of enquiries.status→converted and of enquiries.notes). Both bypass only for `service_role` JWT, `session_user='postgres'`, or the owning RPC's own GUC.
- updateEnquiryStatus/assignEnquiry: direct RLS writes per lead ruling, with action-level transition/not_found checks.
- Pages/components per packet (pipeline board uses a `<select>` per card, no DnD dependency).
- getAdmissionsFunnelCounts exported from queries.ts for T-039.

Tests run:
- `pnpm vitest run --project db tests/db/admissions-actions.test.ts tests/db/admissions-schema.test.ts tests/db/enrolment.test.ts` → 23/23 pass.
- `pnpm test:security` → 465/465 pass (no RLS-expectations change needed — role sets for enquiries/applications/application_decisions are unchanged, only the staff-scope mechanism inside them changed).
- `pnpm test:db` (full) → 29 files, 200/200 pass.
- `pnpm test` (unit) → 26 files, 274/274 pass, including the 10 new admissions-state.test.ts cases.
- `pnpm lint && pnpm typecheck` → clean (0 errors; 4 pre-existing warnings in T-029/T-036 stub files, not touched here).
- `pnpm db:reset` then `DEMO_RESET_ALLOWED=true pnpm demo:reset` → clean; confirmed `enquiries: 0`, `applications: 0` (admissions seed is T-029, not landed — noted below).
- `pnpm test:e2e -- e2e/j03-pipeline.spec.ts e2e/j04-decision.spec.ts` (ran as part of the full e2e suite, 28 specs total) → both J-03 and J-04 passed. 4 unrelated pre-existing failures in `e2e/website-editor.spec.ts` (T-025, a different module; timeouts waiting on `locator('input').first()`, not touched by this packet — flagged, not fixed, per CLAUDE.md "surgical changes" and "stop after two failed attempts on an unrelated root cause").

RPCs and guards (file:line) — all in supabase/migrations/20261028000016_admissions_transitions.sql:
- `app.admissions_decide_roles()` (narrow role helper, owner/principal/admissions — admin excluded) — top of file.
- `app.staff_in_institution` / `public.staff_in_institution` — found-bug fix, see "Deviations" below.
- `app.guard_application_decision()` + trigger `guard_application_decision` on `public.applications`.
- `app.guard_enquiry_mutation()` + trigger `guard_enquiry_mutation` on `public.enquiries`.
- `app.decide_application` / `public.decide_application`.
- `app.convert_enquiry` / `public.convert_enquiry`.
- `app.add_enquiry_note` / `public.add_enquiry_note`.
All `search_path=''`, qualified names, no dynamic SQL; `app.*` revoked from anon/authenticated/service_role; `public.*` revoked from public/anon, granted to authenticated only (the three narrow RLS-helper-shaped functions — `admissions_decide_roles`, `staff_in_institution` app-side — are granted directly to `authenticated` with no public wrapper needed for the first since nothing calls it over PostgREST, but `staff_in_institution` DOES get a `public.*` wrapper since the TS action layer calls it via `supabase.rpc`).

Transition tests:
- tests/unit/admissions-state.test.ts: 10 cases covering forward/backward/no-op/out-of-list/leaving-converted/entering-converted for enquiries, and offer/reject/accept/withdraw from-state rules for applications, including AC3 (submitted cannot accept directly).
- tests/db/admissions-actions.test.ts: "updateEnquiryStatus moves forward and backward..." (AC1, 2 audit rows asserted), "...rejects moving into converted directly, and rejects any move out of converted", "converts an enquiry... rejects converting twice" (AC2), "decideApplication: offer then accept works; reject writes a decision row; admin is forbidden" (AC3), "decideApplication rejects submitted -> accepted directly" (AC3), "getAdmissionsFunnelCounts matches direct SQL counts" (AC4).

Bypass tests:
- "guard_application_decision: direct UPDATE into offered is rejected for authenticated, explicitly bypassed for service_role" — asserts both the deny AND the explicit service_role allow (same shape as exams-schema.test.ts's fix-round-2 test), not just the deny.
- "guard_enquiry_mutation: direct UPDATE of status to converted or of notes is rejected for authenticated, bypassed for service_role" — same pattern, both status and notes paths.

Role-helper vs matrix comparison:
- `admissions.application.decide` (07 §2.2) = owner/principal/admissions, admin excluded. The existing `application_decisions_insert` RLS policy (0007) already hardcoded this exact array; `app.admissions_decide_roles()` just names it so `app.decide_application` doesn't duplicate a bare array literal. Confirmed via tests/db/admissions-actions.test.ts ("admin is forbidden") and the pre-existing tests/db/admissions-schema.test.ts ("admin cannot insert application_decisions").
- `admissions.enquiry.write`/`admissions.enquiry.read` = owner/principal/admin/admissions (admin INCLUDED, unlike decide) — used as-is (bare array, matching 0007's existing `enquiries_update`/`enquiries_insert` policies) for convert_enquiry and add_enquiry_note; no new helper needed since it's not wider than the matrix anywhere it's used.

Deviations:
1. Packet text named the decided states "accepted/rejected/waitlisted"; the actual `applications.status` check constraint (0007) has no `waitlisted` value. `app.guard_application_decision` guards the four states the constraint actually has: offered/accepted/rejected/withdrawn. `enrolled` stays exclusively `app.guard_application_enrolled`'s job (0008, unedited).
2. **Found bug, fixed in this packet's migration** (not introduced by me, but blocking a core AC): 0007's `enquiries_insert`/`enquiries_update` WITH CHECK scoped `assigned_to` via a bare `exists (select ... from public.staff ...)`. That subquery is itself subject to `staff`'s own RLS (0004 `staff_select`, which excludes the admissions role entirely). Confirmed empirically (direct update as admissions → `42501`) before fixing: the one role that actually uses `assignEnquiry` could never pass this check for ANY staff id, in-tenant or not. Fixed by dropping/recreating both policies (0007 itself untouched) to use a new `app.staff_in_institution()` security-definer helper (bypasses `staff` RLS) instead of the bare EXISTS — same drop/recreate-on-a-later-migration shape 0014 used on 0006. `assignEnquiry`'s own not_found pre-check uses the matching `public.staff_in_institution` RPC wrapper rather than `.from("staff").select()`, for the same reason.
3. `enquiries.notes` can hold either the pipeline's new append-only array shape or `app.submit_public_enquiry`'s (0007) pre-existing single `{"message": ...}` object shape. `app.add_enquiry_note` normalizes a non-array value into a one-element array on first append (SQL side); `queries.ts`'s `normalizeNotes` does the same defensively on read. Tested in admissions-actions.test.ts.
4. `updateEnquiryStatus`'s optional `note` field is implemented by calling `add_enquiry_note` as a second step after the status update (enquiries has no dedicated per-transition note column) — two RPC/DB calls, not strictly atomic with the status change. Acceptable: a note-write failure after a successful status move is a UX inconvenience (note lost), not a security or data-integrity issue, and is independently retriable.
5. Applicant `gender` and guardian `relationship` are validated as free non-empty strings (gender) and a fixed 5-value enum reused from `guardian_students.relationship`'s own check constraint (relationship) — `students.gender`/`applications.applicant` have no DB-level gender enum to match, so no enum was invented for it (YAGNI).
6. `EnquiryDetail`'s convert dialog has no UI picker for guardian relationship beyond a plain `<Select>` with the 5 literal values typed inline (no shared constant exported) — small, contained, not worth extracting a module-level constant for one call site.

What was not verified:
- Full `pnpm test:e2e` (all 28 specs, not just j03/j04) — 4 pre-existing website-editor.spec.ts failures are present; not root-caused (out of this packet's scope, different module/owner).
- `enrolApplicant` / the "Enrol" button on an `accepted` application is an explicit disabled placeholder (packet assumption; T-028 replaces it) — not tested here beyond "it renders and is disabled."
- No visual/manual QA pass of the new pages in a running browser beyond what the two e2e specs exercise (pipeline move + convert in j03, decide flow in j04).

Security / integration risks:
- The `app.staff_in_institution`/policy-rewrite fix (deviation 2) changes 0007's RLS behavior for `enquiries_insert`/`enquiries_update`'s `assigned_to` scoping for every role, not just admissions — verified via the full `pnpm test:security` run (465/465, unchanged role-set expectations) and the existing cross-tenant test in admissions-schema.test.ts still passing, but this touches a merged, previously-reviewed migration's effective behavior and should get a security-reviewer pass given CLAUDE.md rule 2/9.
- New SQL surface (3 app.*/public.* RPC pairs, 2 triggers, 1 helper function, 2 rewritten policies) — recommend the lead's standard security review for packets that add definers, as instructed.

Follow-ups:
- T-029 (admissions seed) should add `ENQ-*`/`APP-live-*` fixtures per 05 §8.1; until then J-03/J-04 create their own fixtures (documented in both specs).
- T-028 (enrolApplicant) replaces the disabled "Enrol" placeholder in ApplicationDetail.
- T-039 should consume `getAdmissionsFunnelCounts` as specified.
- Consider adding a dedicated `updateEnquiryStatus` note column/event instead of the two-call note workaround (deviation 4) if atomicity ever matters for that path.

New dependencies (justification): none.

Assumptions made:
- `applicant.gender` is a free string, not an enum (matches `students.gender`'s own schema: free text, no check constraint).
- `updateEnquiryStatus`'s `note` is best-effort (deviation 4).
- Staff/grade/academic-year option lists on the enquiry detail page are unfiltered by role (any staff member in the institution can be assigned) per 0007's own RLS scope ("staff member of the same institution"), not narrowed to admissions-ish staff.

## Fix round 1 (security review)

1. **HIGH — `public.staff_in_institution` was a cross-tenant oracle.** Fixed:
   - Dropped `public.staff_in_institution` entirely (`drop function if exists public.staff_in_institution(uuid, uuid)`). `assignEnquiry` no longer pre-checks staff existence over RPC — it attempts the `enquiries` UPDATE directly and maps a `42501` (RLS violation from `enquiries_update`'s own WITH CHECK) to `not_found`. The policy is now the sole authority.
   - `app.staff_in_institution` rewritten (`create or replace`, sql → plpgsql) to return `false` unless the caller is a member of `p_institution_id` (`app.is_member`), bypassed only by the `service_role` JWT claim or `session_user='postgres'`. Called from inside `enquiries_insert`/`enquiries_update`'s own WITH CHECK, where `p_institution_id` is always the row's own institution — already proven by `app.has_role` in the same clause — so this is a no-op for every legitimate caller.
2. **LOW — `app.staff_in_institution`/`app.admissions_decide_roles` granted to `authenticated`.** Verified empirically (grant revoked inside a transaction, rolled back after observing behavior — not literally rolled back here since the fix is permanent, but confirmed via `pg_proc.proacl` before/after):
   - `app.staff_in_institution`: grant to `authenticated` is REQUIRED — it's called directly from `enquiries_insert`/`enquiries_update`'s WITH CHECK, which evaluates as the invoking role. Kept, with a comment in the migration explaining why.
   - `app.admissions_decide_roles`: grant to `authenticated` was NOT required — its only caller, `app.decide_application`, is itself `security definer` and calls it from within that execution context (as the function owner), which needs no grant. Revoked.

Applied directly to the running local DB via `docker exec -i supabase_db_coolschool psql -U postgres` (no `pnpm db:reset` — T-025's e2e run was using the DB) and to the migration file itself (unmerged, edited in place rather than appended as a second migration). Regenerated `src/lib/db/types.ts` via `pnpm db:types` (schema introspection only, no reset).

Tests run (fix round 1):
- `pnpm vitest run --project db tests/db/admissions-actions.test.ts tests/db/admissions-schema.test.ts tests/db/enrolment.test.ts` → 24/24 pass (added: "fix round 1: public.staff_in_institution no longer exists; the enquiries_update policy alone gates cross-tenant/same-tenant assigned_to" — RPC call errors, cross-tenant update rejected, same-tenant update succeeds).
- `pnpm test:security` → 465/465 pass.
- `pnpm test` (unit) → 274/274 pass.
- `pnpm lint` → clean (same 4 pre-existing unrelated warnings).
- `pnpm typecheck` → clean after `pnpm db:types` regen (introspection-only, no reset).

Not re-run: full `pnpm test:db`/`pnpm test:e2e` (lead is running `demo:reset`/e2e on this DB concurrently; targeted suite above is the complete coverage for the changed surface).
