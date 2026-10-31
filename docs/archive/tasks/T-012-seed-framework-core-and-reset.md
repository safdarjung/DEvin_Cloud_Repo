# T-012 — Seed framework, PRNG, core section, `demo:reset` CLI + guards

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 5 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-06, F-IDN-10, F-IDN-11 |
| Depends on | T-005, T-007, T-010, T-011 (merged) |
| Migration | — |

## Business outcome
A deterministic demo tenant with logins, year, terms, and settings that can be rebuilt in one command before every demo, and a reset that can never touch real data.

## Current repo state (verify before starting)
- Migrations 0001–0005 applied: `ls supabase/migrations/ | wc -l` → 5.
- `pnpm seed` and `pnpm demo:reset` are stubs: `grep -n '"seed"\|"demo:reset"' package.json`.
- `app.demo_reset` exists: `psql "$SUPABASE_DB_URL" -c "\df app.demo_reset"`.

## Spec sections to read (only these)
- `05-data-architecture.md §8` (seed design: PRNG, UUID v5, sections, batching, logins), `§4.1` (settings default JSON — write it verbatim), `§2.1` (core columns).
- `06-workflows-and-contracts.md §W1`, `§W13`.
- `11-operations.md §3` (demo logins, password env), `§5`.
- `07-security-and-ai-governance.md §4` (service-role callers), T10; `12` D19.

## Files to inspect first
- `src/lib/supabase/admin.ts` (caller guard), `src/modules/core/schemas.ts` (create `InstitutionSettingsSchema` here if absent — core module is lead-owned), `package.json` scripts.

## Expected changes
- `scripts/seed/index.ts` — loads env, sets `SERVICE_ROLE_CALLER=seed`, runs sections in order, prints counts/duration; refuses if the demo institution already has students unless `DEMO_RESET_ALLOWED=true` (then resets first).
- `scripts/seed/lib/{prng.ts,ids.ts,batch.ts,context.ts,names.ts}` — `mulberry32(20261028)`, `uuidV5(section, naturalKey)`, `insertBatch(table, rows, 1000)`, `SeedContext` (ids produced by earlier sections), Indian name lists (synthetic).
- `scripts/seed/sections/core.ts` — institution `st-josephs-demo` (`is_demo`, `ai_policy='local_only'`, settings from `05 §4.1`), default campus, year `2026-27` (`is_current`), Term 1/Term 2, sequences rows, auth users + profiles + memberships for the eleven demo logins (`11 §3`), `email_confirm: true`, password `SEED_DEMO_PASSWORD`.
- `scripts/seed/sections/{people,academics,attendance,admissions,finance,exams,website}.ts` — empty stubs exporting `run(ctx)` with a TODO naming the owning packet.
- `scripts/demo-reset.ts` — requires `DEMO_RESET_ALLOWED=true`, `SERVICE_ROLE_CALLER=reset`; calls `app.demo_reset` for the demo institution; re-runs seed; prints counts.
- `src/modules/core/schemas.ts` — `InstitutionSettingsSchema` (Zod) mirroring `05 §4.1`.
- `package.json` — real `seed`, `demo:reset` scripts (`tsx`); `db:reset` chain already calls `pnpm seed`.

## Must not modify
- Migrations; `src/app/**`; other lanes' section files beyond the stubs.

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- Service role only through `admin.ts` with the caller guard; never log keys or the demo password.
- Reset refuses non-demo institutions (C-04) and refuses without the env flag; auth users are preserved across resets (same ids → logins stable).
- Settings JSON validated by `InstitutionSettingsSchema` before insert.

## Acceptance criteria
1. `pnpm seed` on a fresh `db:reset` creates the institution, year, terms, 11 users with memberships; rerun without the flag aborts with a clear message.
2. `pnpm demo:reset` completes; ids of institution/users unchanged; counts printed.
3. C-04: `demo_reset` on a non-demo fixture raises; CLI without `DEMO_RESET_ALLOWED` exits non-zero before touching the DB.
4. Settings row passes `InstitutionSettingsSchema.parse`.
5. Login as `principal@demo.coolskool.test` works (J-00 subset).

## Seed scale
- Support `SEED_SCALE=full|small` in `scripts/seed/config.ts` (`small` = 2 sections per grade, used by CI only); named demo entities (`05 §8.1`) must exist at both scales.

## Tests (write failing tests first) and exact commands
- `tests/unit/seed-lib.test.ts` — PRNG determinism, UUID v5 stability, batch splitting.
- `tests/unit/institution-settings.test.ts` — schema accepts the default, rejects a bad grading band.
- `tests/db/demo-reset.test.ts` — C-04.
- Commands: `pnpm test -- tests/unit/seed-lib.test.ts tests/unit/institution-settings.test.ts`, `pnpm test:db -- tests/db/demo-reset.test.ts`, `pnpm seed`, `pnpm demo:reset`.

## Deliverables
- Seed framework + core section, reset CLI, settings schema, stubs, tests, completion report (include `db:reset` wall time).

## Assumptions and risks
- `tsx` added as a dev dependency (justify in report) unless Node's type-stripping suffices.
- Admin API user creation is rate-limited on hosted; 11 users is fine.

## Completion report
Use the format in `CLAUDE.md`.
