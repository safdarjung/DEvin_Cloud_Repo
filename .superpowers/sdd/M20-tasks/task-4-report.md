Packet: M20-T4 Migration 0093 part 1 — exam_papers.unit_ids, mastery_snapshots, RLS

Files changed:
- `supabase/migrations/20261028000093_mastery.sql` (new, part 1 of 3)
- `tests/helpers/mastery-fixture.ts` (new)
- `tests/db/mastery-rls.test.ts` (new)
- `tests/security/rls-expectations.ts` (+mastery_snapshots row)
- `src/lib/db/types.ts` (raw `pnpm db:types` regen, additive)

Behavior implemented: `exam_papers.unit_ids uuid[]` + `exam_papers_unit_ids_max` check (≤20) + `app.validate_exam_paper_units()` trigger (invoker, no dup, same institution/subject/grade). `mastery_snapshots` table + indexes + `set_updated_at`. RLS select mirrors `results_select`; no write policy; table grants revoked from anon/authenticated except SELECT (mirrors 0095 agent_definitions, the actual precedent for the brief's "0069 grants block" — 0069 itself has no table-grant block).

Tests run: `pnpm db:reset` (full reseed, ~80s, counts unchanged) → `pnpm test:db tests/db/mastery-rls.test.ts` 11/11 pass → `pnpm test:security` 2769/2769 pass (19 files, incl. generated RLS suite picking up the new row) → `pnpm lint` (3 files) clean → `pnpm typecheck` clean.

Tests not run and why: none — all packet ACCEPT commands ran.

Limitations / honesty label: none — read-only migration piece; `mastery` label (`limited`) lands with T15's UI pass.

Security / integration risks: none new. Trigger is security invoker (caller already has exam.manage + curriculum_units SELECT via staff_roles()); table-grant revoke is defense-in-depth, RLS already default-denies.

Follow-ups: none new for this task; T5 appends part 2 (compute_mastery, sweep, read fns) to the same migration file.

New dependencies: none.

Assumptions made: grants-block precedent taken from 0095 (0069 has no such block, despite the brief's READ pointer); cardinality-21 test uses 21 distinct valid units (dup/invalid ids hit the trigger's own check first, before the 23514 constraint); cross-institution unit test plants a bare second institution row directly (not full `createTestInstitution`).
