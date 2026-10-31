# T-003 — Migration 0001: `app` schema helpers, triggers, sequences, grading, demo reset

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 2 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-01, F-IDN-04, F-IDN-06, F-IDN-11, F-IDN-12 |
| Depends on | T-002 (merged) |
| Migration | `supabase/migrations/20261028000001_foundation.sql` |

## Business outcome
The shared SQL kernel every later migration relies on: RLS helpers, immutability and audit triggers, gap-free human numbers, grading lookup, and a safe dynamic demo reset.

## Current repo state (verify before starting)
- No migrations yet: `ls supabase/migrations/ | wc -l` → 0.
- Local Supabase up: `pnpm db:start`.

## Spec sections to read (only these)
- `05-data-architecture.md §4.1` (settings keys used by `grade_for`, numbering patterns), `§5` (helper list and policy classes), `§6` (history semantics, `app.allow_reset`), `§7` (migration order).
- `06-workflows-and-contracts.md §1.1` (SQL error convention `code:…`), `§W13`.
- `07-security-and-ai-governance.md §4` (allow-list), threat T10.
- `12-decision-log.md` D4, D15, D19, D20.

## Files to inspect first
- `supabase/config.toml` (confirm `app` not exposed).

## Expected changes
- `20261028000001_foundation.sql` containing, in order:
  - `create extension if not exists pgcrypto; create schema if not exists app; revoke all on schema app from public, anon, authenticated;`
  - `app.set_updated_at()` trigger fn; `app.block_mutation()` raising `code:invalid_state` on UPDATE/DELETE unless `current_setting('app.allow_reset', true) = 'on'`.
  - `app.audit(institution_id, actor, action, entity_type, entity_id, before, after, metadata)` — inserts into `public.audit_events` (table created in 0003; declare the function after a `create table if not exists` stub is **not** allowed — instead define `app.audit` in 0003; here create only the signature-less helper `app.current_user_id()`). Record this split in the report.
  - RLS helpers from `05 §5`: `app.current_user_id`, `app.is_platform_admin`, `app.member_institutions`, `app.is_member`, `app.has_role`, `app.staff_roles`, `app.finance_roles`, `app.exam_roles`, `app.staff_id`, `app.guardian_student_ids`, `app.own_student_id`, `app.teaches_section` — all `stable security definer set search_path = ''`, using `(select auth.uid())`; the ones referencing tables from later migrations are created here with bodies that reference `public.*` names from `05 §2` (Postgres resolves at call time), and T-004/T-010/T-011 tests prove them.
  - `app.next_sequence(institution_id, key)` — `insert … on conflict do update` then `select … for update`; renders pattern tokens `{FY}`, `{YYYY}`, `{SEQ:n}`; pattern read from `institutions.settings->'numbering'` by key prefix.
  - `app.grade_for(institution_id, scale_key, percentage)` — reads `settings->'exams'->'grading_scales'`.
  - `app.demo_reset(institution_id)` — raises unless `is_demo`; sets `set local app.allow_reset = 'on'`; discovers tables with an `institution_id` column, topologically orders by FK, deletes in one transaction; returns per-table counts.
  - Grants: `grant usage on schema app to authenticated, anon`; `grant execute` only on helpers RLS needs; `revoke execute` on `next_sequence`, `demo_reset`, `grade_for` from `anon, authenticated`.

## Must not modify
- `config.toml` schemas; anything under `src/`.

## Permissions / nav / migration numbers needed from the lead
- Migration number 0001 reserved here.

## Security and data-integrity requirements
- Every function `set search_path = ''` and schema-qualified references; `security definer` only where listed.
- `demo_reset` must refuse non-demo institutions before any delete; must not touch `profiles`/`auth.users`.
- No function returns data for an institution the caller is not a member of (helpers return booleans/ids scoped by `auth.uid()`).

## Acceptance criteria
1. `pnpm db:reset` applies 0001 cleanly; `pnpm db:types` succeeds.
2. `app` schema not reachable via PostgREST (`curl` to `/rest/v1/rpc/next_sequence` with anon key → 404/permission error).
3. `next_sequence` renders `INV/2026-27/000001` for pattern `INV/{FY}/{SEQ:6}` on 2026-10-28 and increments without gaps under 50 concurrent calls (C-06).
4. `grade_for` returns A1 for 91, D for 33, E1 for 32.99 with the default scale.
5. `demo_reset` on `is_demo=false` raises `code:forbidden`; on a demo institution with rows in a temp tenant table deletes them and leaves another institution's rows intact (C-04 part 1).
6. `block_mutation` raises on UPDATE/DELETE and allows them under `app.allow_reset = 'on'` within a transaction.

## Tests (write failing tests first) and exact commands
- `tests/db/foundation.test.ts` — C-06, grade_for boundaries, block_mutation, demo_reset guard (uses a temporary table created and dropped inside the test).
- Command: `pnpm test:db -- tests/db/foundation.test.ts`.

## Deliverables
- Migration 0001, regenerated `src/lib/db/types.ts`, tests, completion report noting the `app.audit` placement decision.

## Assumptions and risks
- Helpers referencing tables created later compile because plpgsql resolves at runtime; if a helper is `sql` language it must be `plpgsql` or created after its tables — prefer plpgsql.
- Dynamic topological delete must handle self-referencing FKs (`superseded_by`): delete with `superseded_by` set to null first or use `on delete` order; test with a temp self-referencing table.

## Completion report
Use the format in `CLAUDE.md`.
