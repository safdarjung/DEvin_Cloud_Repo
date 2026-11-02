# M14 security review — 0076 diff + lifecycle/people actions

Scope: `supabase/migrations/20261028000076_student_lifecycle.sql`,
`src/modules/lifecycle/*`, `src/modules/people/{actions,schemas}.ts`,
`src/app/api/v1/{actions,query}/all-*.ts` wiring. Reviewed against
BRIEF-COMMON.md security lessons 1-13 and M14-tasks.md rulings.

Clean: tenant scoping on every FK (lesson 2), `search_path=''` + qualified
names + no dynamic SQL on all three definers (lesson 4), grants
(`revoke ... from public, anon; grant ... to authenticated`), GUC bypass
guard uses `service_role`/`postgres` only, never null uid (lesson 5), RLS
SELECT policy matches 07 §2.2 shape with initPlan-wrapped helpers (lesson
1/7), audit payloads carry ids/counts/changed-field-names only, no PII
values (lesson 10), `tc_snapshot` built from rows not caller JSON (lesson
3), `students`/`guardians` UPDATE RLS already scoped to `student.write`
roles so `people.student.update`/`guardian.update` add no new surface.

## Findings

### 1. [HIGH → FIXED] `exit_student` double-exit race (duplicate TC)

**File:** `supabase/migrations/20261028000076_student_lifecycle.sql`,
`public.exit_student`.

**Issue:** the function read `v_student` with a plain `select` (no lock),
then later checked `if v_student.status <> 'active'`. Two concurrent
`exit_student` calls on the same student both read `status = 'active'`
before either transaction wrote anything, so **both passed validation,
both committed** — issuing two different TC numbers, two
`student_lifecycle_events` rows, and two `lifecycle.*` audit entries for
one withdrawal. No DB constraint blocks it (the two event rows have
different `tc_no`s, so the partial unique index doesn't fire). This
violates the rulings' own acceptance line ("second exit of the same
student → `invalid_state`") under concurrency, which only the sequential
test (`tests/db/lifecycle-exit-rpc.test.ts`, "exiting an already-exited
student") exercised.

**Reproduced:** added
`"two concurrent exits of the same student never both succeed (no double TC)"`
to `tests/db/lifecycle-exit-rpc.test.ts`. Pre-fix: both calls returned
`error: null` with `TC/2026/00001` and `TC/2026/00002` for the *same*
student — confirmed red via debug run (not a flaky false-negative; re-run
5x green after the fix).

**Fix:** `select * into v_student from public.students where id =
p_student_id for update;` — locks the row so the second concurrent call
blocks until the first commits, then re-evaluates `v_student.status`
against the fresh (now `'withdrawn'`) row and correctly raises
`code:invalid_state`.

**Outcome:** fixed. `pnpm test:db tests/db/lifecycle-exit-rpc.test.ts`
8/8 pass, race test re-run 5x clean. Full milestone DB suite (58 tests,
10 files) + `tests/security/{escalation,grants}.test.ts` (911 tests) +
unit suite + lint + typecheck all green after the fix.

### 2. [investigated, no change needed] `link_guardian` concurrent primary swap

**File:** same migration, `public.link_guardian`.

Same read-then-branch shape as #1 (`select * into v_student ...;` with no
lock before the `is_primary` demote-then-upsert), so I suspected the same
class of bug: two concurrent "set as primary" calls both demoting the
*same* original primary row, then both upserting their own row to
`is_primary = true`, leaving two primaries.

**Checked, not reproducible:** added
`"two concurrent primary links never leave two primaries"` to
`tests/db/guardian-link-rpc.test.ts` and ran it 5x against the
*unfixed* code — always exactly one primary. Reason: the demote step is
`update guardian_students set is_primary = false where student_id = ...
and is_primary` — a predicate on "whichever row is currently true", not a
fixed id. The two concurrent demote statements lock-contend on that same
row; whichever runs second, after the first commits, re-evaluates the
predicate against the now-current primary (the *other* call's new row)
and demotes that instead. The pattern is self-correcting under Postgres's
standard UPDATE row-locking, unlike `exit_student`'s fixed-value status
check. No code change made (ponytail: don't add a lock nothing is broken
without).

**Outcome:** no_change_needed. Test kept as a regression guard; it is
not tied to a code change.

### 3. [MEDIUM → FIXED] `tests/security/grants.test.ts` 07 §4 allowlist drift

**File:** `tests/security/grants.test.ts`, `PUBLIC_AUTHENTICATED`.

**Issue:** T2-T5 added three new `public.*` SECURITY DEFINER functions
(`promote_students`, `exit_student`, `link_guardian`) but the hardcoded
"authenticated may execute exactly the 07 §4 public RPCs" allowlist in
the security suite was never updated. The suite caught its own drift
(failed, rather than silently passing) — but a failing security-suite
test at HEAD is itself a release blocker per `code-review.md`'s CI gate,
and masks real grant regressions (a genuinely-overbroad new grant would
fail the same assertion and could be waved through as "that's just the
known M14 gap").

**Fix:** added the three names in alphabetical order (the array's
existing convention).

**Outcome:** fixed. `pnpm test:security tests/security/escalation.test.ts
tests/security/grants.test.ts` → 911/911 pass.

## Not re-checked here (already covered, no new surface)

- `promote_students` role/validation-failed ordering, idempotency via the
  `enrolments_one_active_per_year_idx` partial unique index, and the
  `for update of e` + EvalPlanQual re-check pattern — matches rulings,
  traced through by hand, no gap found.
- `people.student.update` / `people.guardian.update` mass-assignment:
  blocked by `.strict()` Zod schemas (only known camelCase keys parse) and
  by the handler building its own `row` object field-by-field — `status`,
  `user_id`, `details`, `photo_path` are never reachable from the action
  input regardless of what a caller sends.

## Full gate after fixes

- `pnpm test:db` (10 M14-touched files): 58/58 pass
- `pnpm test:security tests/security/escalation.test.ts
  tests/security/grants.test.ts`: 911/911 pass
- `pnpm test tests/unit/lifecycle-schemas.test.ts
  tests/unit/permissions.test.ts tests/unit/action-names-unique.test.ts`:
  50/50 pass
- `pnpm lint`: clean
- `pnpm typecheck`: clean
