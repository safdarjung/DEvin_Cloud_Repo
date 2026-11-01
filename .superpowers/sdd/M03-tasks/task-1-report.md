Packet: T-0NN M03-T1 — Migration 0064: invitations table, bootstrap guard, create_institution

Files changed:
- `supabase/migrations/20261028000064_onboarding.sql` (new, 224 lines)
- `tests/db/onboarding-rpc.test.ts` (new)
- `src/lib/db/types.ts` (regen, raw `pnpm db:types` output, additions only — +53 lines, 0 deletions)
- `tests/security/grants.test.ts` (edit — added `public.create_institution` to `PUBLIC_AUTHENTICATED`)
- `tests/security/rls-expectations.ts` (edit — added `invitations` entry + new optional `selectColumns` field on `TableExpectation`)
- `tests/security/rls-generated.test.ts` (edit — generic SELECT loop uses `selectColumns` when declared, else `"*"`)

Behavior implemented:
- `public.invitations`: full column set per brief (institution_id, email lower-case-checked, role same check list as memberships, staff/guardian/student FKs, token_hash unique, invited_by/accepted_by → profiles, expires/accepted/revoked timestamps), `set_updated_at` trigger, RLS on, SELECT policy for owner/principal/admin only, no INSERT/UPDATE/DELETE policy (RPC-only, M03-T2). Table-wide SELECT revoked from `authenticated`; column-level SELECT granted on every column except `token_hash`.
- `app.guard_membership_write()`: 0038 body unchanged, plus an early `return new` when `app.allow_membership_bootstrap` is `on` (coalesce-guarded GUC read, never reachable from PostgREST).
- `public.create_institution(p_name, p_slug, p_timezone default 'Asia/Kolkata', p_year_start default null) returns uuid`: security definer, `search_path=''`. Validates caller auth, name length (2-120), slug regex/length/reserved list, and a 3-owned-institutions quota (shortcut: per-user cap, no billing model yet — comment in code). Inserts institution (settings = locale timezone/currency only, per brief's "unless schemas.ts needs the full object" — it validates a much larger shape but nothing requires seeding it at creation), an `OWN-001` staff row for the caller, the caller's own `owner` membership under the bootstrap GUC, a current academic year (Apr 1 on/before today unless `p_year_start` given) and two terms (Term 1 to Sep 30, Term 2 from Oct 1), and one `core.institution.created` audit row (no PII — no name/slug/email in metadata). `execute` revoked from public/anon, granted to authenticated (service_role gets it automatically via 0046's default-privilege rule).

Migration length vs ~150-line cap: 224 lines. Breakdown — `invitations` table + index + trigger + RLS policy + column grants is ~45 lines; `app.guard_membership_write` is a `create or replace` so it carries 0038's full body (~45 lines) even though only ~4 lines are new; `create_institution` itself is ~115 lines because it is the only EXPORT doing real work — caller auth, three independent validations with distinct error codes, year/term date arithmetic, a nested exception block for the duplicate-slug case, and five inserts across four tables (institutions/staff/memberships/academic_years/terms) plus one audit call. The brief names all three EXPORTS for this one file; splitting across migrations wasn't an option (one owner per numbered file, 10-backlog-index). No speculative code — every line maps to a brief requirement; this is scope overrun, not padding.

Tests run:
- RED: `pnpm test:db tests/db/onboarding-rpc.test.ts` before `migration up` → 7/7 failed (PGRST202, function not found).
- GREEN: same command after `pnpm exec supabase migration up --local` → 7/7 passed.
- `pnpm test:security` → 18/18 files, 1107/1107 passed (after the two expectation-file edits below).
- `pnpm lint` → clean (0 errors; fixed one unused-import warning in the new test file along the way).
- `pnpm typecheck` → clean (`next typegen && tsc --noEmit`).

Tests not run and why: `pnpm test:db` full suite (not required by this packet's ACCEPT line; ran only the packet's own file per DB-owner rule).

Limitations / honesty label: n/a — backend-only RPC, no UI, no simulated/limited surface.

Security / integration risks:
- `app.current_user_id() is null` is checked before any validation — unauthenticated callers get `code:unauthenticated`, never reach the quota/slug checks.
- Bootstrap GUC (`app.allow_membership_bootstrap`) is transaction-local (`set_config(..., true)`), set only inside this definer function, coalesce-guarded on read (same NULL-safety lesson as 0042/0043) — confirmed by security suite's "every app.* GUC compare is NULL-safe" test.
- Reviewed `invitations`' column-level grant against the generic cross-institution RLS suite (`rls-generated.test.ts`): `select("*")` 42501s at the grant layer (not an RLS 0-row filter) because `token_hash` isn't grantable table-wide. Added an opt-in `selectColumns` field to `TableExpectation` so the generated suite can assert the same cross-tenant claim over the columns `invitations` actually grants, instead of weakening the shared assertion for every table. This is a generic test-infra extension (defaults to `"*"`, used only by `invitations` today), not a table-specific carve-out.
- `grants.test.ts`'s `PUBLIC_AUTHENTICATED` list is the actual hardcoded expectation (not `scripts/audit-grants.sql`, which is only the query) — updated it to include `public.create_institution`, as the brief's ACCEPT line anticipated ("grants test must list the new function").
- Did not touch `scripts/audit-grants.sql` — the security suite's requirement was satisfied entirely in `grants.test.ts`'s own expectation arrays; the query file needed no change.

Follow-ups: M03-T2 (invite_member/accept_invitation/revoke_invitation) is the only writer of `invitations` rows; this task leaves the table structurally ready but unused until then.

New dependencies (justification): none.

Assumptions made:
- `auth.users` is readable inside this `security definer` function the same way `public.handle_new_auth_user`'s trigger already touches `auth.users` (0002) — confirmed empirically: the RPC's `select email from auth.users where id = v_uid` worked against local Supabase with no grant error.
- Staff `full_name` falls back to the literal `'Owner'` when `profiles.full_name` is null (profiles allows null; `staff.full_name` is `not null`) — brief said "full_name from profiles" but didn't specify a null fallback.
- `institutions.settings` is seeded with only `{"locale": {...}}` at creation (brief's own fallback clause), not core/schemas.ts's full `InstitutionSettingsSchema` shape (academic/attendance/etc.) — nothing in the brief or schema requires those defaults to exist before the owner configures them, and `institution.updateSettings` (M03-T8) is the intended place to set them.
