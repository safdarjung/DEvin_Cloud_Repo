# T-009 — Test harness: per-role clients, action caller, generated RLS suite, CI wiring

| Field | Value |
|---|---|
| Lane / Day | D / Day 3 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-03, F-IDN-04 (verification) |
| Depends on | T-002, T-004 (merged) |
| Migration | — |

## Business outcome
Every later packet can prove tenant isolation and role behaviour with real JWTs against real RLS, and a generated suite fails the build whenever a new tenant table lacks a declared expectation.

## Current repo state (verify before starting)
- Core tables exist: `grep -c 'institutions' src/lib/db/types.ts` > 0.
- Vitest projects configured: `grep -c projects vitest.config.mts` > 0.
- CI workflow exists: `ls .github/workflows/ci.yml`.

## Spec sections to read (only these)
- `08-testing-and-acceptance.md §1` (helpers contract: `createTestInstitution`, `clientAs`, `callAs`, factories), `§3` C-01, C-02.
- `07-security-and-ai-governance.md §6` (checklist shape, `rls-expectations.ts`), `§2` (role list).
- `05-data-architecture.md §5` (policy classes to encode as expectations).
- `CLAUDE.md` Testing conventions.

## Files to inspect first
- `vitest.config.mts`, `tests/setup/global.ts` (placeholder), `src/lib/supabase/admin.ts` (guard expects `SERVICE_ROLE_CALLER=test`).

## Expected changes
- `tests/helpers/roles.ts` — `createTestInstitution(name)` (admin client: institution `is_demo=true`, one user per role via `auth.admin.createUser`, memberships; returns ids + `clientAs(role)` building a `supabase-js` client signed in as that user); `withTwoInstitutions(fn)`; cleanup via `app.demo_reset`.
- `tests/helpers/actions.ts` — `callAs(role, action, input)` injecting a resolver that returns the ctx for that user (uses `defineAction`'s resolver injection from T-008).
- `tests/helpers/factories.ts` — deterministic builders (student, guardian, staff, section, year/term) that insert via the admin client; extended by later packets.
- `tests/setup/global.ts` — ensures Supabase is reachable, sets `SERVICE_ROLE_CALLER=test`, loads `.env.local`/`.env.test`.
- `tests/security/rls-expectations.ts` — `{ table: { classes: ['S'|'S+G'|'C'|'T'|'A'|'P'|'O'], read: Role[], write: Role[], guardianScope?: 'student_id' } }` for the seven core tables now; later packets add rows.
- `tests/security/rls-generated.test.ts` — queries `pg_tables` (public) via `SUPABASE_DB_URL`; fails if a table with `institution_id` lacks an expectation; for each table × role: cross-institution SELECT = 0 rows, INSERT/UPDATE/DELETE with foreign `institution_id` fails (C-01); same-institution read allowed/denied per expectation.
- `tests/security/membership-status.test.ts` — C-02.
- `.github/workflows/ci.yml` — ensure `pnpm test:db` and `pnpm test:security` run after `supabase start` with keys exported.

## Must not modify
- `supabase/migrations/**`; `src/lib/auth/permissions.ts`.

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- Test users use `@test.coolskool.test` emails and random passwords; never reuse demo accounts.
- Fixture institutions are `is_demo=true` so reset can clean them; never run against hosted.

## Acceptance criteria
1. `pnpm test:security` runs the generated suite over the seven core tables and passes.
2. Adding a temporary tenant table without an expectation makes the suite fail with a message naming the table (prove, then drop the table).
3. `clientAs('teacher')` queries respect RLS (teacher cannot read `institution_sequences`).
4. C-02 passes.
5. CI runs unit, db, security projects; a failing security test fails the workflow (observed or reported as not run).

## Tests (write failing tests first) and exact commands
- Files above; commands: `pnpm test:security`, `pnpm test:db -- tests/db/core.test.ts` (must still pass using the new helpers).

## Deliverables
- Helpers, global setup, expectations file, generated suite, C-02 test, CI update, completion report.

## Assumptions and risks
- Signing in test users via password in tests is slower than minting JWTs; acceptable (≈100 ms each). If total time > 60 s, cache sessions per file.
- `pg_tables` access needs the direct DB URL; CI exports it from `supabase status`.

## Completion report
Use the format in `CLAUDE.md`.
