# Task 2+3 report — M04-T2 (import tables + RLS) / M04-T3 (commit_import_batch)

Packet: T-002/T-003 M04 import — migration 0066 (tables+RLS, then commit function), one DB owner.

Files changed:
- `supabase/migrations/20261028000066_imports.sql` (new) — `import_batches`/`import_rows` tables + RLS (T2), then appended: `public.commit_import_batch` + 3 narrow `app.*` SECURITY DEFINER helpers it needs (T3).
- `tests/db/imports-rls.test.ts` (new) — T2 RLS tests.
- `tests/db/imports-commit.test.ts` (new) — T3 commit-function tests.
- `tests/security/rls-expectations.ts` — added `import_batches`/`import_rows` rows (generated RLS suite auto-discovers any table with `institution_id`; would otherwise fail).
- `tests/security/grants.test.ts` — added the 3 new `app.*` helpers to `APP_AUTHENTICATED` (grants allow-list suite would otherwise fail).
- `src/lib/db/types.ts` — regenerated (`pnpm db:types`), raw output, additions only.

## Behavior implemented

**T2**: `import_batches` (status staged/committed, counts, created_by/committed_by) and `import_rows` (row_no, data jsonb, errors, status, entity_id; unique (batch_id, row_no)). RLS SELECT/INSERT/UPDATE = owner/principal/admin only on both (narrower than the usual staff_roles() read, matching `data.import`, M04-T1). `import_rows` INSERT/UPDATE additionally binds `batch_id` to a batch of the same institution. No DELETE policies. `set_updated_at` triggers.

**T3**: `public.commit_import_batch(p_batch_id uuid) returns jsonb` — security invoker, `search_path=''`, execute to `authenticated` only. Locks the batch, distinguishes `not_found` (no such batch) from `forbidden` (same-institution caller below owner/principal/admin) from `committed` (returns stored counts, no writes). Per `valid` row, own exception block: students — admission_no dup → skipped; else insert student → reuse-or-create guardian by phone → link (always primary — a freshly created student has no prior links) → active enrolment → row committed, entity_id set. Staff — employee_no dup → skipped; else insert → committed. Any exception → row invalid, `errors` = one mapped fixed-text message by sqlstate (unique/check/FK/not-null/bad-date/bad-value), never the row's data. Batch counts/status/committed_by/at updated once; one `app.audit` row with counts only.

### Design deviation beyond the literal brief (both load-bearing, not optional — flagging per CLAUDE.md rule 10/"new dependency" spirit even though these are new *functions*, not a package)

1. **`app.lock_import_batch`** (new, SECURITY DEFINER peek+lock) — `commit_import_batch` is invoker, so its own `select ... for update` on `import_batches` is RLS-filtered to owner/principal/admin (T2); that alone can't distinguish "no such batch" from "exists, caller's role is too low" (both read back no row) — but the brief's TEST FIRST explicitly wants `teacher → forbidden`, a distinct outcome. This definer peek bypasses RLS just to read institution_id/status so the role check that follows can raise a real `forbidden`. Same shape as `app.staff_in_institution` (0016).
2. **`app.audit_import_commit`** (new, SECURITY DEFINER wrapper) — `app.audit` (0003) has no EXECUTE grant to `authenticated` by design (so no caller can forge an audit row); an invoker function can't call it directly. This wrapper re-validates the caller's role, then delegates — same "validate, then delegate" shape as `app.enqueue_job` (0003).
3. **`app.import_insert_guardian_student`** (new, SECURITY DEFINER wrapper) — **found a real, pre-existing bug**, not introduced by this packet: a bare RLS-governed `insert into guardian_students` throws `"infinite recursion detected in policy for relation guardian_students"`. Root cause: `guardian_students_insert`'s `with check` (0020) does `exists (select ... from students ...)`, which runs `students_select`, which does `id in (select app.my_student_ids())`; `app.my_student_ids` (0020) is a `language sql` function, which Postgres can inline — an inlined SQL body runs under the *caller's* privileges, not the SECURITY DEFINER owner's, so its own `from guardian_students` loses the RLS bypass and re-enters `guardian_students`' policy while that same relation's policy is already being evaluated for the outer INSERT. Reproduced and isolated directly against local Postgres (confirmed `postgres` role has `rolbypassrls=true`; confirmed the recursion fires specifically on the INSERT, not on the same predicate run as a standalone SELECT). Never fired before because every existing write to `guardian_students` goes through a SECURITY DEFINER RPC (0008's enrol flow) that bypasses its RLS entirely — `commit_import_batch` is the first invoker-mode caller. Out of scope to fix `app.my_student_ids` itself (merged migration, rule 9). This wrapper re-implements exactly what the real policy already requires (role + both FKs in-institution) and inserts as the owner, sidestepping the recursive path. Scoped to imports only, not a general replacement for the policy.

This tripled the function count for T3 beyond the literal `EXPORTS:` line (which names only `commit_import_batch`), but all three are private `app.*` helpers in the same migration file — no new files, no change to the one exported public signature.

## TDD

**T2** — RED: `tests/db/imports-rls.test.ts` run before the migration was applied → 5/5 failed (`relation "public.import_batches" does not exist` / `PGRST205`). GREEN: after `pnpm exec supabase migration up --local --include-all` + `pnpm db:types` → 5/5 passed.

**T3** — RED: `tests/db/imports-commit.test.ts` run before the function existed → 6/6 failed (`PGRST202 Could not find the function`). GREEN: after applying the function (local `create or replace function` via a one-off node `postgres` script reading `SUPABASE_DB_URL` from `.env.local`, no env values printed, script deleted after) + `pnpm db:types` → 6/6 passed. One intermediate RED→RED cycle mid-T3: initial GREEN attempt hit the `guardian_students` recursion bug above (4/6 failed with `code 42P17`); fixed via `app.import_insert_guardian_student`, re-applied, re-ran → 6/6.

## Tests run

- `pnpm test:db tests/db/imports-rls.test.ts` → 1 file, 5/5 passed.
- `pnpm test:db tests/db/imports-commit.test.ts` → 1 file, 6/6 passed.
- `pnpm test:security` → 18 files, 1256/1256 passed (after adding the two `RLS_EXPECTATIONS` rows and the three `APP_AUTHENTICATED` entries — both updates were required, flagged per the ACCEPT line's "say so").
- `pnpm lint` → clean (0 errors; fixed one unused-import warning along the way).
- `pnpm typecheck` → clean (fixed one `sql.json` arg type in the new test file: narrowed from `Record<string, unknown>` to `Record<string, string | number | boolean | null>`, matching the actual row-data shapes used).

## Tests not run and why

- Full `pnpm test` / `pnpm test:db` (whole suites) — brief says run only this packet's files while working; not asked to run the full gate (that's the lead's checkpoint per CLAUDE.md).
- `pnpm test:e2e` — not applicable to a DB-only packet.

## Limitations / honesty label

No UI; not applicable. No AI involved; not applicable.

## Security / integration risks

- The `guardian_students` RLS-recursion bug (item 3 above) is real and pre-existing in merged migrations 0004/0020. It is dormant for every *other* table so far (verified `enrolments`, `students`, `guardians` inserts all work fine as invoker — only `guardian_students` closes the cycle, because only its own policy's dependency chain loops back to itself). Any *future* code that tries a plain RLS-governed write to `guardian_students` (not through a SECURITY DEFINER RPC) will hit the same crash. Worth a follow-up to fix `app.my_student_ids`/`app.my_taught_student_ids` at the root (e.g., rewrite as `language plpgsql` so Postgres can't inline them) rather than relying on per-caller wrappers.
- `commit_import_batch` is reachable only by owner/principal/admin (checked twice: the `app.lock_import_batch` + `has_role` pair, and again implicitly by every RLS-governed write it performs). Row errors never include CSV data (mapped fixed-text by sqlstate only) — verified by an explicit test assertion.
- No PII or CSV row data is echoed in any error path or audit row (audit stores counts only).

## Follow-ups

- New debt entry for `12-decision-log.md` §Debt: `app.my_student_ids`/`app.my_taught_student_ids` (0020/0025/0035) are SQL-language and inlinable, which drops their SECURITY DEFINER RLS bypass when inlined into a caller's policy — causes `infinite recursion detected in policy for relation guardian_students` on any *direct* RLS-governed write to `guardian_students`. Recommend converting to `language plpgsql` (never inlined) in a future migration.
- T4–T8 (CSV parsing, stage/commit actions, CSV export, acceptance+templates) are unstarted — next in the M04 task order.

## New dependencies

None.

## Assumptions made

- `commit_import_batch`'s `not_found` vs `forbidden` split: "unknown" = no such batch id at all; "hidden"/insufficient role = same-institution caller below owner/principal/admin → `forbidden` (does not hide cross-institution existence — matches `revoke_invitation`'s (0079) existing precedent of using `forbidden` for any role shortfall after a definer-level peek, rather than a stricter BOLA-style "hide existence across tenants" design). Not specified explicitly in the brief beyond the literal not_found/forbidden wording.
- `import_batches.file_name` made `not null` (brief states only the length check, not null-ness) — every batch logically has a source file name; no test exercised a null value either way.
- Recommit return shape: both the first commit and any later recommit return the batch's *stored, cumulative* counts (not just the current call's delta) so the two calls are directly comparable — satisfies "recommit → same counts" literally.
