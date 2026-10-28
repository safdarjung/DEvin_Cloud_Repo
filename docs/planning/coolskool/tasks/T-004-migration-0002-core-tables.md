# T-004 — Migration 0002: core tables + RLS

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 2 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-01, F-IDN-03, F-IDN-09, F-IDN-10, F-IDN-11 |
| Depends on | T-003 (merged) |
| Migration | `supabase/migrations/20261028000002_core.sql` |

## Business outcome
Tenants, campuses, academic years and terms, user profiles, memberships, and sequences exist with RLS, so a user can belong to an institution and every later table has something to hang off.

## Current repo state (verify before starting)
- 0001 applied: `ls supabase/migrations/ | grep 0001`.
- Helpers exist: `psql "$SUPABASE_DB_URL" -c "\df app.*" | grep -c is_member` → 1.

## Spec sections to read (only these)
- `05-data-architecture.md §2.1` (rows institutions…institution_sequences), `§4.1` (settings JSON default), `§5` (policy classes O, S, A).
- `07-security-and-ai-governance.md §2` (who may manage settings/members), T1, T13.
- `12-decision-log.md` D4, D15.

## Files to inspect first
- `20261028000001_foundation.sql` (helper signatures, `set_updated_at`).

## Expected changes
- `20261028000002_core.sql`: `institutions`, `campuses`, `academic_years`, `terms`, `profiles`, `memberships`, `institution_sequences` exactly per `05 §2.1` (columns, checks, uniques, partial uniques, indexes, `updated_at` triggers).
- Trigger `on auth.users insert` → insert `profiles` (id, full_name from `raw_user_meta_data`).
- Trigger on `memberships` validating role ↔ link column (staff/guardian/student) and writing a revision audit row (via `app.audit` once 0003 exists — if 0003 is not merged yet, emit the audit call inside a function `app.membership_changed()` created in 0003; note the dependency in the report).
- Trigger on `terms` checking dates within the academic year.
- RLS: enable on all seven tables. `institutions`: SELECT by `app.is_member(id)`; UPDATE by `app.has_role(id, '{owner,principal,admin}')`; no INSERT/DELETE policy (seed only). `campuses/academic_years/terms`: class S read, write by owner/principal/admin. `profiles`: class O (own row select/update) plus SELECT of profiles that share an institution with the caller. `memberships`: class O SELECT own rows; owner/principal/admin SELECT/INSERT/UPDATE within their institution; no DELETE (status change only). `institution_sequences`: no policies (function-only).
- Regenerate `src/lib/db/types.ts`.

## Must not modify
- 0001; `config.toml`; `src/` beyond generated types.

## Permissions / nav / migration numbers needed from the lead
- Migration number 0002 reserved here.

## Security and data-integrity requirements
- `institutions.slug` globally unique, lowercase, `^[a-z0-9-]+$` check.
- Exactly one `is_current` year per institution (partial unique index).
- `memberships` unique (institution_id, user_id, role); disabled membership must lose access immediately (helpers check `status = 'active'`).
- No policy grants `anon` anything in this migration.

## Acceptance criteria
1. `pnpm db:reset` green; types regenerated.
2. C-01 for these tables: user of institution A cannot SELECT/INSERT/UPDATE/DELETE institution B rows in any of the seven tables.
3. C-02: setting `memberships.status = 'disabled'` makes `app.is_member` false in the same session.
4. C-05: second `is_current = true` year for the same institution fails; term outside year fails.
5. Inserting an `auth.users` row via the admin API creates a `profiles` row.
6. Member of A sees only A's `institutions` row; a non-member sees zero rows for the slug.

## Tests (write failing tests first) and exact commands
- `tests/db/core.test.ts` — C-01 (core tables), C-02, C-05, profile trigger.
- Command: `pnpm test:db -- tests/db/core.test.ts`.
- Uses per-role clients from `tests/helpers/roles.ts` if T-009 has landed; otherwise a minimal inline helper that T-009 replaces.

## Deliverables
- Migration 0002, generated types, tests, completion report.

## Assumptions and risks
- `settings jsonb not null default '{}'`; the full default (`05 §4.1`) is written by the seed, validated by `InstitutionSettingsSchema` (T-012), not by the DB.
- Multi-institution users are supported by data model but the picker UI is T-007.

## Completion report
Use the format in `CLAUDE.md`.
