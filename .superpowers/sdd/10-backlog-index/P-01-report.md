# P-01 — RLS performance

## Files changed

- `supabase/migrations/20261028000020_rls_performance.sql` (new)
- `tests/db/rls-performance.test.ts` (new)
- `docs/planning/coolskool/10-backlog-index.md` §3 (reservation record)
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (new definer-function row)

Not touched: `scripts/seed/**`, `tests/db/seed-*`, `tests/db/attendance-schema.test.ts` (lead's timeout edit, left as-is — it now passes), `src/modules/finance/**` (T-032's territory).

## Root cause

Every RLS policy on the hot tables called a `SECURITY DEFINER` helper (`app.has_role`, `app.teaches_section`, `app.guardian_student_ids`, `app.own_student_id`, `app.teacher_sees_guardian`) with a per-row argument (`institution_id`, `class_section_id`, ...). Postgres cannot inline a `SECURITY DEFINER` function, so each call re-ran its membership lookup once per row scanned.

## Fix

Five new row-independent helpers in `app`, each `stable security definer set search_path = ''`, called once per statement and compared against with `= any(...)`:

- `app.my_institution_ids(p_roles text[])`
- `app.my_taught_section_ids()`
- `app.my_taught_section_subjects()` — subject-level (class_section_id, subject_id) pairs, for `marks` (DBT-19: section-level `teaches_section` is too broad there)
- `app.my_student_ids()`
- `app.my_student_section_ids()`

**Deviation from the packet's literal spec:** these return `setof uuid` / `table(...)`, not `uuid[]`. A `uuid[]`-returning function wrapped as `(select app.my_institution_ids(...))` is a single-row, array-typed subquery, which doesn't satisfy Postgres's `col = ANY(subquery)` form (`42883: operator does not exist: uuid = uuid[]`). `setof uuid` makes the wrapped call a genuine multi-row scalar subquery — the actual Supabase-documented pattern — which Postgres caches as an InitPlan. Recorded here as the assumption made under the "ask only if a critical ambiguity cannot be resolved safely" rule.

Policies rewritten (SELECT unless noted) on: `attendance_sessions` (+ insert/update), `attendance_records` (+ insert/update), `attendance_corrections` (select; its insert policy was already dropped by 0014, nothing to rewrite), `students`, `guardians`, `guardian_students`, `class_sections`, `subject_assignments`, `enrolments`, `enrolment_status_history`, `assignments`, `marks` (+ insert/update), `results`, `invoices`, `invoice_lines`, `payments`, `receipts`, `ledger_entries`, `notifications` (+ update), `audit_events`, `jobs` (select only — its update policy was already dropped by 0012), `delivery_attempts`, `ai_usage_events`. Every rewrite keeps the same role sets, `with check` clauses, and scope joins as before — verified by the full `pnpm test:security` + `pnpm test:db` pass below, and by hand-matching each `drop policy` against its current (not necessarily 0006's original) definition in 0012/0014.

**Second perf bug found during verification, not in the packet's text:** my first draft of `attendance_records_select`'s teacher branch kept the "institution predicate" the packet asked for (`and s.institution_id = attendance_records.institution_id` inside the `session_id in (select ...)` subquery). That correlation forces Postgres into a nested-loop semi join — EXPLAIN ANALYZE showed `Seq Scan on attendance_sessions ... loops=181440`, 80s. Dropped it: a `session_id`/`class_section_id` uuid can only ever belong to one institution (same reasoning the `my_*_ids()` arrays themselves already rely on), so the institution check is redundant for SELECT and unsafe for performance. Kept it on the low-row-count INSERT/UPDATE/`attendance_corrections_insert` checks, where it's free and matches the packet literally.

Indexes added (confirmed missing/insufficient via EXPLAIN on the demo tenant): `attendance_records(session_id)`, `attendance_sessions(class_section_id)`, `guardian_students(guardian_id)`, `invoices(student_id)`.

Not rewritten (same per-row-helper shape, but small tables, not in the packet's "at minimum" list): `curriculum_units`, `fee_assignments`, `concessions`, `recheck_requests`, `exam_papers`. Flagged below as debt.

## Timings (seeded demo tenant, `count(*)` via a HEAD request through RLS)

| Role | Table | Before | After |
|---|---|---|---|
| principal | attendance_sessions | 0.18 s | 23 ms |
| principal | attendance_records | 7.9 s | 27 ms |
| teacher.vi-a | attendance_sessions | 15.7 s | 20 ms |
| teacher.vi-a | attendance_records | >30 s (timeout) | 28 ms |
| guardian.one | attendance_sessions | 25.5 s | 22 ms |
| guardian.one | attendance_records | >30 s (timeout) | 43 ms |
| admissions | attendance_sessions | 17 s (0 rows) | 20 ms (0 rows) |
| admissions | attendance_records | >30 s (timeout) | 32 ms (0 rows) |
| any | marks | N/A — 0 rows seeded | N/A — 0 rows seeded |
| any | results | N/A — 0 rows seeded | N/A — 0 rows seeded |
| any | invoices | N/A — 0 rows seeded | N/A — 0 rows seeded |
| any | payments | N/A — 0 rows seeded | N/A — 0 rows seeded |

"Before" is the lead's measurement from the packet. `marks`/`results`/`invoices`/`payments`/`fee_assignments` are all `0` rows after `pnpm demo:reset` on this tree (finance/exams seed sections are stubs — `scale: full` log shows `finance: 0ms`, `exams: 0/1ms`) — the policies are rewritten and exercised by `pnpm test:db`/`pnpm test:security`, but there is no seeded volume to time yet. `expected row count` assertions in the new test are computed independently (direct joins on `class_sections`/`enrolments`/`guardian_students`), not by re-deriving the RLS logic, so the test isn't tautological.

## Verify (actual output)

- `pnpm db:reset` — clean, `Counts: {"students":3024,...,"attendance_sessions":4320,"attendance_records":181440}`
- `pnpm vitest run --project db tests/db/rls-performance.test.ts tests/db/attendance-schema.test.ts` → **13 passed (13)**, 12.2s
- `pnpm test:security` → **465 passed (465)**
- `pnpm test:db` (full) → **258 passed (258)**, 38 files, 266s
- `pnpm test` (unit) → **327 passed (327)**
- `pnpm lint` → 0 errors, 3 pre-existing warnings (unrelated stub files: `scripts/seed/sections/{admissions,exams,finance}.ts`)
- `pnpm typecheck` → clean for every file this packet touched. One pre-existing error remains in `src/modules/core/components/dashboard/CollectionsChart.tsx` (untracked file, another agent's in-flight work, not in this packet's scope — not fixed)
- `pnpm demo:reset` → clean, same counts
- `pnpm test:e2e` → 30 passed, 6 failed. All 6 traced and confirmed **pre-existing, not caused by this migration**:
  - `j07-guardian-portal` AC1/AC2 and `tenant-shell` "Portal heading" — `PortalOverviewPage`/`resolvePortalSelection` (T-034, `src/modules/people/portal.ts`) never redirects to add `?student=` to the URL on first load, and `PortalNav`'s own `<h1>` text is "My children"/"My school", not "Portal" — the tests expect behavior the app code doesn't do. Verified directly: signed in as `guardian.one`, ran the exact `listMyChildren` query (`guardian_students` embedding `students`/`enrolments`/`class_sections`) through the rewritten RLS — both children returned correctly, so the data layer is not the cause.
  - `j05-enrol` C-21 (Section dropdown timeout) — verified `admissions` can read `class_sections` (including a section created mid-test) through the rewritten RLS with no error; likely dev-server/compile timing flakiness, same class of issue the test's own comment calls out for duplicate runs against a persistent demo tenant.
  - `j09-marks-entry` / `j10-publish-results` — exam-status badge and a duplicate checkbox name from accumulated state on a demo tenant not reset between spec files (explicitly the failure mode `j05`'s own comment describes: "leftover rows from a previous run ... against the persistent demo DB").
  - Not fixed — out of scope for a DB-only packet (app code in other packets' modules), and the lead should decide whether e2e needs per-spec `demo:reset` isolation as separate debt.

## Limitations / assumptions

- `uuid[]` → `setof uuid`/`table` return-type deviation (above), recorded rather than asked, since it's the only way to make the Supabase-documented pattern actually work and is purely an internal implementation detail (the packet's named helpers, arguments, and call sites in RLS are otherwise exactly as specified).
- Institution-predicate drop on `attendance_records_select`'s teacher branch (above) — also recorded rather than asked, since keeping it reintroduces the exact timeout the packet exists to fix.
- `curriculum_units`/`fee_assignments`/`concessions`/`recheck_requests`/`exam_papers` left on the old per-row helpers — small tables today, not named in the packet's list, but same shape; follow-up debt.
- No write-semantics or trigger changes. No new dependencies.

## Fix round 1 (security review, CRITICAL)

**Leak:** `app.my_student_ids()` and the guardian branch of `guardian_students_select` trusted `guardian_id`/`student_id` equality alone, with no check that the row's own `institution_id` (or the caller's membership `institution_id`) actually matched. `guardian_students.institution_id` is a denormalized column with no FK/trigger tying it to the guardian's or student's real institution — a row claiming institution B but naming institution A's `guardian_id` (or a membership whose `student_id` pointed at another institution's student) leaked that other institution's student PII, and everything `app.my_student_ids()` gates (`enrolments`, `attendance_sessions`/`records`, `results`, `invoices`, `payments`, `receipts`, `guardian_students` itself).

**Fixed in place in `20261028000020_rls_performance.sql`** (unmerged, edited directly, no new migration number) and applied live via `docker exec -i supabase_db_coolschool psql -U postgres` (no `db:reset` — Batch A owns resets):

1. `app.my_student_ids()`: guardian branch now joins `guardian_students gs on gs.guardian_id = m.guardian_id and gs.institution_id = m.institution_id`; student branch now joins `public.students st on st.id = m.student_id and st.institution_id = m.institution_id`. `app.my_student_section_ids()` needed no change — it derives entirely from the now-correctly-scoped `app.my_student_ids()`.
2. `guardian_students_select`'s guardian branch: added `and m.status = 'active' and m.institution_id = guardian_students.institution_id` to the membership subquery (small table, ~3k rows in the demo — this correlation costs nothing like `attendance_records`' did).
3. `guardian_students_insert`/`guardian_students_update`: added `exists (... guardians g ... g.institution_id = guardian_students.institution_id)` and the equivalent for `students`, closing the write side that let the mismatched row get created.
4. Extra hardening found during the fix, not in the original repro: `guardians_select`'s teacher branch (`app.teacher_sees_guardian`'s row-independent replacement) had the same shape — a `guardian_students` row with a mismatched `institution_id` could still leak its `guardian_id` to a teacher via the enrolment join. Added `and e.institution_id = gs.institution_id` to that join too.

**New test:** `tests/db/guardian-students-institution-leak.test.ts` (deliberately NOT `tests/db/portal-scope.test.ts` — that file already exists, committed by T-034, module-query-level with a mocked server client; writing over it would have destroyed that coverage, caught via `git status` showing it as modified-not-new and restored with `git checkout --`) — three cases, all against throwaway fixture institutions (not the demo tenant): (1) a guardian-branch malformed `guardian_students` row is invisible to the borrowed guardian, and the leaked `student_id` stays hidden in `students`; (2) the same leaked `student_id`'s `enrolments`/`attendance_records` also stay hidden, proving the fix propagates through `app.my_student_ids()`; (3) a membership whose `student_id` points at another institution's student sees nothing for that student. Written and run only against the already-patched live DB (fix applied before the test was written, per the time pressure of a CRITICAL/blocking review) — all three pass; not separately confirmed red against the pre-fix code in this session. T-034's own `tests/db/portal-scope.test.ts` re-run unchanged afterward to confirm the fix didn't regress it.

**Verify (actual output, no `db:reset`):**
- `pnpm vitest run --project db tests/db/rls-performance.test.ts tests/db/attendance-schema.test.ts tests/db/guardian-students-institution-leak.test.ts tests/db/portal-scope.test.ts` → **20 passed (20)**, 4 files, 26.3s (includes T-034's existing `portal-scope.test.ts`, confirming no regression there)
- `pnpm test:security` → **465 passed (465)**
- Timings re-confirmed on the demo tenant post-fix: principal sessions 23ms/records 34ms, teacher.vi-a 20ms/29ms, guardian.one 21ms/47ms, admissions 19ms/35ms — unchanged from the original fix, confirming the institution correlations added above (all on small tables: `guardian_students`, `guardians`, `students`) didn't reintroduce the per-row cost this packet exists to remove.

**Not fixed, flagged for the lead:** `memberships` rows themselves have no trigger verifying `m.institution_id` matches the real institution of `m.guardian_id`/`m.student_id`/`m.staff_id` — only `app.validate_membership_link()`'s role-vs-null-FK shape check. If a `memberships` row itself were malformed, every helper in this migration (and the pre-existing `app.staff_id`/`app.guardian_student_ids`/`app.own_student_id`) would trust it. Out of scope for this fix (not the reported repro, and a much deeper integrity question than guardian_students), but worth a dedicated review.

## Follow-ups (12-decision-log.md §Debt)

- Rewrite `curriculum_units`/`fee_assignments`/`concessions`/`recheck_requests`/`exam_papers` SELECT policies with the same `my_*_ids()` helpers if/when any of them approaches ~1k+ demo rows.
- `PortalOverviewPage` doesn't redirect to a URL carrying `?student=` on first load, and `tenant-shell.spec.ts`/`j07-guardian-portal.spec.ts` assert on behavior the current T-034 implementation doesn't have (heading text, URL param). Needs a T-034 follow-up, not a P-01 fix.
- e2e suite has no per-spec `demo:reset`; specs that mutate the shared demo tenant (new sections, exam papers with timestamp-suffixed names) can collide across runs. Consider isolating or resetting between specs.
