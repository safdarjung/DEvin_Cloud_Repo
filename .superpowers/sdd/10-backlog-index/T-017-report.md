Packet: T-017 Migration 0009: exams tables, versioning, publish/recheck functions

## Files changed
- `supabase/migrations/20261028000009_exams.sql` (new)
- `src/lib/db/types.ts` (regenerated, additions-only)
- `tests/db/exams-schema.test.ts` (new)
- `tests/security/rls-expectations.ts` (added 7 exam table entries)
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (the one row this packet may edit — appended the two definer functions)

## Behavior implemented
7 exam tables (`exams`, `exam_papers`, `marks`, `results`, `recheck_requests`, `recheck_decisions`, `answer_sheets`), versioning + immutability triggers (`app.marks_guard`, `app.results_guard`), revision-audit triggers (AFTER INSERT only — see below), RLS per table, and two security-definer functions: `app.exam_verification` (internal only, no `public.*` wrapper), `app.publish_exam_results` (06 §W7), `app.apply_recheck_decision` (06 §W8). Also `app.term_attendance_percentage`, a helper needed to build the results snapshot's `attendancePercentage` but not separately named by the packet.

## Table × operation vs 07 §2.2 matrix (lesson #1)
| Matrix row | Roles | `app.exam_roles()` (0001) | Fix |
|---|---|---|---|
| exam.manage | own/pri/exc | +admin (wider) | new `app.exam_write_roles()` = own/pri/exc, used for exams/exam_papers writes |
| exam.result.publish | own/pri/exc | +admin (wider) | `exam_write_roles()` gates `app.publish_exam_results` |
| exam.recheck.review+decide | own/pri/exc | +admin (wider) | `exam_write_roles()` gates `app.apply_recheck_decision` |
| exam.marks.enter | own/pri/exc/tch(s) | +admin (wider) | marks RLS uses `exam_write_roles()` + subject-matched teacher, never admin |
| exam.result.read | own/pri/adm/exc/tch(s)/stu(s)/grd(s) | exact match | kept `app.exam_roles()` for results/recheck_decisions SELECT |

## Deviations (recorded)
1. `marks.superseded_by`/`results.superseded_by` are `deferrable initially deferred` FKs, and "one current row per (paper, student)" / "(exam, student)" is enforced by a deferred constraint trigger (`app.marks_one_current_check`/`app.results_one_current_check`), not the plain partial unique index the spec's constraints column names. A plain immediate unique index/FK makes the only possible supersede write order impossible: Postgres checks non-deferred constraints per internal statement even inside a single function call (confirmed empirically), and it also collides with `app.demo_reset` (0001, not editable)'s generic "null every self-referencing FK column, then delete" sweep, which momentarily un-supersedes every row of an institution in one UPDATE. Deferring to commit fixes both; plain (non-unique) indexes are kept for query performance.
2. Added `app.term_attendance_percentage` (not named in the packet's function list, required to build the snapshot).
3. Revision-audit triggers on marks/results are AFTER INSERT only (not AFTER UPDATE) — this is what makes C-42's "two audit rows" come out exactly right (one marks insert + one results insert on the recheck-approve path).
4. Added a `marks` UPDATE RLS policy (same role set as INSERT) — the packet's RLS bullet only names SELECT/INSERT, but the versioning scheme needs an UPDATE path and no security-definer function in this packet's scope performs it for the plain pre-publish-entry case.

## Tests run
1. `pnpm db:reset` — clean apply.
2. `pnpm vitest run --project db tests/db/exams-schema.test.ts` → **6/6 passed**.
3. `pnpm test:security` → **465/465 passed**.
4. `pnpm test:db` (full) → **27 files, 179/179 passed**.
5. `pnpm test` (unit) → **22 files, 235/235 passed**.
6. `pnpm lint && pnpm typecheck` → clean (4 pre-existing warnings in other packets' seed stubs, unrelated).

## Limitations / honesty label
No UI; this packet is DB-only, as scoped. No honesty-label concern.

## Follow-ups / debt
- No `app.enter_marks` function exists yet (06 §W7 names one) — the next exam-entry task should build it as a single-transaction RPC (same shape as `app.apply_recheck_decision`), not two separate client calls — see Fix round 1 below for why that matters.
- `startRecheckReview` (submitted→under_review) has no RLS UPDATE policy on `recheck_requests` yet — not in this packet's scope.
- `app.exam_verification` has no `public.*` wrapper (no UI verification panel yet) — add one when that UI task lands.

## New dependencies
None.

## Assumptions made
- Attendance % with no attendance rows returns 0 (packet's own stated assumption).
- Snapshot JSON shape documented in the migration's header comment for T-019.

## Fix round 1

Security review found 1 CRITICAL, 1 LOW. Both fixed in place in 0009 (unmerged, per rule).

**CRITICAL — marks tampering after publish.** Neither `app.marks_guard` nor the `marks` RLS `with check` checked `exams.status`, so a bare subject teacher could insert a new "entry" version and supersede the old one on an already-published exam — no recheck, no approval, and the audit trail read as an ordinary entry. `superseded_by` also accepted any existing marks row, including another student's (the FK is global). Fixed:
- `app.marks_guard` (now `security definer`, so its nested `app.current_user_id()` call works for every firing role) looks up the paper's exam status and rejects INSERT/UPDATE unless status is `marks_entry`/`verification`, OR `app.allow_marks_revision` is set for the transaction, OR the caller has no JWT context at all (`app.current_user_id() is null` — same "trusted internal/service-role caller" reasoning used elsewhere in this codebase, e.g. `app.enqueue_job`). Same status check added to `marks_insert`/`marks_update`'s RLS `with check` (defense in depth; `app.apply_recheck_decision` bypasses RLS entirely as a security-definer function, so the RLS-level check only matters for direct PostgREST writes).
- `app.apply_recheck_decision` now calls `perform set_config('app.allow_marks_revision', 'on', true)` before its own marks write, and inserts the new marks row *first* (so the guard's cross-row check below has a real row to validate against), then updates the old row to point at it — reversing the migration's original update-then-insert order for marks specifically (results is untouched; it has no RLS write path at all, so it was never reachable by this attack).
- `app.marks_guard`'s UPDATE branch now also validates, on every supersede, that the target row (`new.superseded_by`) exists and shares the same `exam_paper_id`, `student_id` and `institution_id` as the row being superseded, is itself still current (`superseded_by is null`), and was created after it. Cross-student/cross-paper/backdated targets all raise `code:invalid_state`.
- Seed path (point d): documented, not built — the exams seed section (still a stub, 0ms) is expected to insert marks while the exam is `marks_entry` and only then call `publish_exam_results` itself, same as a real exam controller. The null-`current_user_id()` bypass exists for a trusted service-role caller doing the same thing, not as a status override; no seed code was added or changed by this fix (out of this packet's scope).

New tests (`exams-schema.test.ts`, "fix round 1 (CRITICAL)"): teacher post-publish INSERT rejected; exam_controller post-publish direct INSERT rejected; teacher post-publish supersede rejected (direct tamper of another student's row); a raw cross-student `superseded_by` UPDATE rejected even bypassing the status gate; a pre-publish correction during `marks_entry` still works (via a single transaction — see note below); recheck approve still works post-publish (2 audit rows, 1 job).

Note on the pre-publish-correction test: it uses one `sql.begin()` transaction for its insert+update pair, not two separate RLS client calls. That's not a test shortcut — it reflects a real, now-confirmed constraint: the insert-then-update supersede sequence can only ever be atomic within one transaction (the deferred "one current row" check fires at commit, and two separate PostgREST requests are two separate commits). This is exactly why `app.apply_recheck_decision` does both writes itself, and it means the future `app.enter_marks` (06 §W7 already names it as a single-transaction function) must do the same — a plain two-call RLS flow from the client can never perform a supersede. Flagged above under follow-ups.

**LOW — `app.term_attendance_percentage` didn't filter by `institution_id` itself.** Added explicit `institution_id` filters to the term lookup, the enrolment lookup, and the attendance-records query (defense in depth; the two callers already derive `p_institution_id`/`p_student_id`/`p_term_id` from institution-scoped rows, so this closes a theoretical gap rather than a reachable one).

### Fix round 1 — verification (actual output)
1. `pnpm db:reset` — clean apply.
2. `pnpm db:types` — additions-only.
3. `pnpm vitest run --project db tests/db/exams-schema.test.ts` → **7/7 passed**.
4. `pnpm test:security` → **465/465 passed**.
5. `pnpm test:db` (full) → **28 files, 189/189 passed**.
6. `pnpm test` (unit) → **25 files, 264/264 passed**.
7. `pnpm lint` → clean (4 pre-existing warnings in other packets' seed stubs). `tsc --noEmit` → clean.

## Fix round 2

Security review (defense in depth): `app.marks_guard`'s bypass condition (round 1) was `app.current_user_id() is null`, i.e. "no JWT `sub`" — but `anon` also has a null `auth.uid()`. The guard itself would have waved an `anon` write straight through; the only reason `anon` was actually blocked was that `marks` has no RLS policy granting it anything at all. Round 1's reasoning ("no JWT context means trusted") was wrong — `anon` has a JWT, just no user id in it.

Fixed: the bypass is now two explicit, named checks instead of "absence of a user id":
- `coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'` — the PostgREST JWT's own role claim, for the seed and the job runner calling through PostgREST with the service key.
- `session_user = 'postgres'` — a direct superuser connection (no PostgREST, no JWT at all, e.g. a script on `SUPABASE_DB_URL`).
- `current_user` was deliberately not used for either check: `app.marks_guard` is `security definer`, so `current_user` inside it is always the function's owner (`postgres`), regardless of who is actually connected — the same trap that made the round-1 bypass too broad.
- `app.allow_marks_revision` (the recheck path) is unchanged.

Checked `app.results_guard` and the rest of 0009 for the same pattern: `results_guard` never calls `app.current_user_id()` and has no bypass at all, so it needed no change. `app.publish_exam_results`/`app.apply_recheck_decision` each have an `app.current_user_id() is null` check too, but that one *rejects* null-uid callers (requires authentication) rather than granting them trust — not the same bug, and not in this round's scope (also means `service_role` still can't call those two RPCs directly today; not addressed here, flagged as a follow-up since the exams seed section is still a stub).

New tests (`exams-schema.test.ts`, "fix round 2"): `anon` insert into `marks` denied (RLS, as always); `service_role` insert on a published exam succeeds (the explicit, named bypass); an authenticated `exam_controller` insert on the same published exam, same table, is still denied with no GUC set.

### Fix round 2 — verification (actual output)
1. `pnpm db:reset` — clean apply.
2. `pnpm vitest run --project db tests/db/exams-schema.test.ts` → **8/8 passed**.
3. `pnpm test:security` → **465/465 passed**.
4. `pnpm test:db` (full) → **28 files, 190/190 passed**.
5. `pnpm lint` → clean (same 4 pre-existing, unrelated warnings).
