Packet: M14-T3 Migration 0076 part 2 — promote_students
Files changed: supabase/migrations/20261028000076_student_lifecycle.sql
(append — public.promote_students, precedent 0017, no app.* twin);
tests/db/lifecycle-promote-rpc.test.ts (new); src/lib/db/types.ts (raw
`pnpm db:types` regen, additions only).
Behavior: section-mapping + override rollover, overrides win over mappings,
p_exclude wins over both; graduates on null target; sets
app.allow_lifecycle so T2's guards admit the status writes; one batch_id,
one lifecycle.promoted audit; idempotent via the `status = 'active'`
candidate filter + FOR UPDATE row locks.
Tests run: pnpm db:reset, pnpm db:types (clean) → pnpm test:db
tests/db/lifecycle-promote-rpc.test.ts → 1 file, 8 passed → pnpm lint
clean → pnpm typecheck clean.
Tests not run: tests/db/lifecycle-exit-rpc.test.ts /
guardian-link-rpc.test.ts (T4/T5, not written yet — same file, append
next in order); full pnpm test:db / pnpm test:security (not DB owner for
other packets' suites this turn; not required by this packet's ACCEPT
line).
Limitations/honesty: n/a (no UI).
Security/integration risks: none found; admissions/teacher confirmed
forbidden; cross-institution and from-year target sections confirmed
validation_failed; re-run confirmed idempotent (zero counts, unchanged row
count).
Follow-ups: T4 exit_student, T5 link_guardian append to this same file in
strict order (unchanged from T2's follow-up).
New dependencies: none.
Assumptions: audit entity_type/entity_id for lifecycle.promoted =
('academic_year', toYearId) — rulings specify "year ids + counts only" in
metadata but not an explicit entity anchor.
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
