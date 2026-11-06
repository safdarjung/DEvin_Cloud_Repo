# M25 security review findings (lane-f)

## MEDIUM — docs/planning/coolskool/07-security-and-ai-governance.md §4, briefings.service-role.ts row

New §4 row claims "briefings table is not RLS-protected because reads always
pass through the action layer". Contradicts
`supabase/migrations/20261028000092_insights.sql`, which enables RLS on
`public.briefings` and defines `briefings_select` scoping rows by role
(matches §2.2's `insight.read` role set). Real protection is two-layer
(RLS + TS permission/module gate), stricter than documented. A future
auditor reading the doc alone would under-scope a review of this table.

## LOW — tests/db/dashboard-briefing-route.test.ts

Task-7's own report (`.superpowers/sdd/M25-tasks/task-7-report.md`) admits
the lost-narration-race branch in `route.ts` (`setBriefingHeadline` returns
`false` -> `readBriefing` re-read) has no dedicated test; verified safe by
code review (atomic CAS `UPDATE ... WHERE provider IS NULL`) but should get
a deterministic test seeding a row with `provider` already set between
`ensureBriefing` and `setBriefingHeadline`.

---

# Outcomes

## MEDIUM (docs §4 briefings row) — fixed

`docs/planning/coolskool/07-security-and-ai-governance.md` line 185: rewrote
the "Reads use the caller's own client" clause to name `briefings_select`
(`20261028000092`) as the primary RLS gate (owner/principal/admin see every
role; admissions/accountant/exam_controller/teacher see only their own role,
matching §2.2), with the route's `insight.read`+`ai_briefings` check as a
second, independent gate. Also fixed the row's trailing summary clause
("briefings has no INSERT/UPDATE/DELETE policy" — true — but it previously
implied no SELECT policy either; now says it has a SELECT policy but no
write policy). No migration edit needed (0092 is HOSTED-APPLIED and the
policy itself was already correct — only the doc was wrong).

## LOW (dashboard-briefing-route.test.ts race test) — fixed

Added `tests/db/dashboard-briefing-route.test.ts` test "lost narration race:
setBriefingHeadline loses the provider-is-null CAS -> route re-reads and
returns the winning row, model null". Forces the race deterministically:
the mocked `runStructured` call itself updates the row's `provider`/`headline`
(simulating a second narrator winning) before resolving, so the real
`setBriefingHeadline` CAS update affects 0 rows and the route falls into its
`readBriefing` re-read branch. Asserts the response carries the *other*
narrator's headline/provider and `model: null`, and that the persisted row
matches. (See "Tests run" below for the actual pass output.)

This is coverage for already-implemented (correct) behavior, not a
behavioral fix, so "write failing test first" was verified as a sanity
check instead: temporarily dropped `.is("provider", null)` from
`setBriefingHeadline`'s update in `src/modules/insights/briefings.ts` ->
new test failed (`"This call's own headline (discarded)."` !=
`"Other narrator won."`, 1 failed / 7 passed) -> restored the `.is(...)`
guard -> 8/8 pass. Confirms the test actually exercises the CAS, not a
vacuously-true assertion. `briefings.ts` is back to its original content
(verified no diff).

## Tests run

- `pnpm test:db tests/db/dashboard-briefing-route.test.ts` -> 1 file, 8
  passed (7 pre-existing + the new race test).
- Sanity RED: with `.is("provider", null)` temporarily removed from
  `setBriefingHeadline` -> same file, 1 failed / 7 passed (only the new
  race test failed, as expected).
- `pnpm test tests/unit/ai-route-modules.test.ts
  tests/unit/dashboard-briefing-prompt.test.ts
  tests/unit/dashboard-briefing-schema.test.ts` -> 3 files, 27 passed
  (unaffected by the doc-only and test-only changes; rerun per packet
  convention).
- `pnpm typecheck` -> clean.
- `pnpm lint` -> 0 errors, 11 pre-existing warnings (`src/lib/nav.ts`,
  `src/modules/fabric/components/fabric-sections.tsx`,
  `tests/unit/mastery-schemas.test.ts`) — none in touched files.

## Files touched

- `docs/planning/coolskool/07-security-and-ai-governance.md` (MEDIUM fix)
- `tests/db/dashboard-briefing-route.test.ts` (LOW fix — new test)
- `src/modules/insights/briefings.ts` — touched only transiently for the RED
  sanity check, reverted to its original content (no net diff).

No migration edit: 0092 is HOSTED-APPLIED and its `briefings_select` policy
was already correct; only the doc describing it was wrong. No git commits
made (working tree only).
