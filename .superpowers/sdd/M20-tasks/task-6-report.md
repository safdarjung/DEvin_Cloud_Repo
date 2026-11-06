Packet: M20-T6 Migration 0093 part 3 — interventions on insight_actions

Files changed: `supabase/migrations/20261028000093_mastery.sql` (append part 3); `tests/helpers/mastery-fixture.ts` (+`insertGapPlan`); `tests/db/mastery-interventions-rls.test.ts` (new); `src/lib/db/types.ts` (raw regen); `.superpowers/sdd/M20-tasks/progress.md` (new — M19 contract facts, no controller pass had written it yet).

Behavior implemented: `insight_actions` +6 columns + `kind` discriminator + check constraint, `insight_actions_one_intervention` unique partial, student-intervention index, `app.guard_intervention` (invoker, BEFORE INSERT OR UPDATE: kind-change forbidden for everyone, steps/status sync for every writer, state-machine for non-trusted), 4 new RLS policies (permissive+restrictive select/update, restrictive insert/delete) keyed on owner/principal or `app.my_class_teacher_student_ids()` (X07, reused not redefined), column grant. No M19 object edited.

Tests run: `pnpm db:reset` (clean, 3024 students) → `pnpm test:db tests/db/mastery-interventions-rls.test.ts` 13/13 pass → `pnpm test:db tests/db/mastery-rls.test.ts tests/db/mastery-compute-sql.test.ts tests/db/insight-actions.test.ts tests/db/insights-rls.test.ts tests/db/insights-acceptance.test.ts tests/db/insights-detect-job.test.ts tests/db/insight-queries.test.ts tests/db/insights-rpcs.test.ts tests/db/insight-explain.test.ts tests/db/approvals-pending.test.ts` 83/83 pass → `pnpm test:security` 3082/3082 pass (no rls-expectations/grants edit needed) → `pnpm lint` (2 files) clean → `pnpm typecheck` clean.

Tests not run and why: none — all ACCEPT commands ran.

Limitations / honesty label: none new — `limited` badge lands with T15.

Security / integration risks: none new. The one subtlety: non-trusted INSERT of an intervention row is denied by RLS alone (raw `42501`, zero permissive INSERT policy) — the trigger deliberately never raises its own exception on INSERT, or the literal-`42501` test would instead see a trigger-raised `code:forbidden`.

Follow-ups: none new. T9/T10/T12/T14 can read `.superpowers/sdd/M20-tasks/progress.md` § M19 contract now that it exists.

New dependencies: none.

Assumptions made: fixture insight rows use `signal: 'academics.marks_decline'` (M19's real enum has no `mastery_gap` value yet — T12's problem); `insertGapPlan`'s M19 `owner`/`rationale` text are fixture placeholders, not T12's real wording.
