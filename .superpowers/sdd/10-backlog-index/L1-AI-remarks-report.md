# L1 — AI report-card remarks report

DB owner this round: ran db:reset, db:types, test:db, test:security, test, lint, typecheck.

## Files changed

- `supabase/migrations/20261028000047_result_remarks.sql` (new) — `public.result_remarks` (mutable, rule 5 exempt — editorial commentary): `institution_id`, `result_id` (unique), `remark` (1–500 chars check), `created_by` (`auth.users`), timestamps + `app.set_updated_at()` trigger. SELECT mirrors `results_select` (0020 P-01) exactly via `app.exam_roles()` / `app.my_taught_student_ids()` / `app.my_student_ids()`. INSERT/UPDATE: `app.has_role(institution_id, app.exam_write_roles())` OR the result's taught teacher. No DELETE. `created_by` pinned at INSERT, made immutable at UPDATE via a guard trigger (`app.guard_result_remark_created_by`, same shape as 0039's `guard_assignment_created_by` — a self-referencing `old.created_by` check can't live in WITH CHECK).
- `src/modules/exams/schemas.ts` — `SaveResultRemarkSchema` (resultId uuid, remark 1–500).
- `src/modules/exams/actions.ts` — `saveResultRemark` (permission `exam.marks.enter`). Proves the result belongs to the caller's institution, then select-then-branch (UPDATE-by-id vs INSERT) instead of a Postgrest upsert — an upsert would set `created_by = excluded.created_by` on every column including the UPDATE path, tripping the immutability guard the moment a *different* in-scope teacher/controller edits an existing remark.
- `src/modules/exams/queries.ts` — `getResultRemark(ctx, resultId)`, pure RLS scope.
- `src/modules/ai/remark-scope.ts` (new) — `canDraftRemarkForResult`, the app-layer mirror of the write RLS (owner/principal/exam_controller, or class-teacher/any-subject-teacher of the student's enrolled section — not paper/subject-scoped like marks entry, since one remark covers the whole result).
- `src/modules/ai/remark.schemas.ts` (new) — `RemarkGenerationSchema` (one `remark` string, 1–500 chars; 500 is the quiz route's bisected-safe threshold too).
- `src/modules/ai/prompts/remark.ts` (new) — nonce-delimited data block (same shape as `quiz.ts`), input is only subject names/marks/grade/percentage — never a student name. Output draft carries a literal `{studentLabel}` placeholder.
- `src/app/api/ai/report-remark/route.ts` (new) — same shape as `/api/ai/quiz`: cross-site check, 8KB body cap, `getTenantContext`, `requirePermission(ctx, "exam.marks.enter")`, loads the result + subject names, `canDraftRemarkForResult` scope check, `runStructured({ feature: "result_remark_draft", maxOutputTokens: 2048 })`.
- `src/modules/exams/components/RemarkDraftEditor.tsx` (new) — client: Draft → editable textarea (substitutes `{studentLabel}` with the real name client-side) → Save (calls `saveResultRemark`). Honesty header "AI draft — review before saving" + `ProviderBadge`. Staff-editing view only.
- `src/components/ui/textarea.tsx` (new) — standard shadcn Textarea primitive; didn't exist yet and `RemarkDraftEditor` needed one.
- `src/app/(tenant)/[institution]/exams/[examId]/results/[studentId]/page.tsx` — mounts `RemarkDraftEditor` gated on `exam.marks.enter` + `canDraftRemarkForResult`, prefilled from `getResultRemark`.
- `src/modules/exams/components/ReportCard.tsx` (guardian/student-facing, shared by the staff page) — renders the saved remark plainly (`result.remark` equivalent via `getResultRemark`) if one exists, no AI language.
- `tests/unit/remark-scope.test.ts`, `tests/unit/remark-prompt.test.ts` (new).
- `tests/db/result-remarks.test.ts` (new) — RLS read/write scope (teacher taught vs. untaught student, guardian own-child, exam_controller/admin institution-wide read) + `saveResultRemark` action, plus a forged-`created_by` direct-insert rejection.
- `tests/security/rls-expectations.ts` — added `result_remarks` entry.
- `tests/security/escalation.test.ts` — added `exam.remark.save` fixture.
- `src/lib/db/types.ts` — regenerated (`pnpm db:types`), additions only.

## Behavior implemented

Teacher on a student's report-card detail page can draft a one-sentence AI remark from the student's marks only (never their name), edit it, and save. Saved remark then renders plainly on the guardian/student report card. A teacher outside their teaching scope gets `not_found` (existence of the out-of-scope result is never revealed, matching `results_select`'s own rule).

## Tests run

- `pnpm vitest run tests/db/result-remarks.test.ts tests/unit/remark-scope.test.ts tests/unit/remark-prompt.test.ts` → 3 files, 15 passed.
- `pnpm test:db` → 46 files, 313 passed.
- `pnpm test:security` → 18 files, 1018 passed.
- `pnpm test` (unit) → 40 files, 423 passed.
- `pnpm lint` → clean.
- `pnpm typecheck` → clean.
- `pnpm db:reset` → clean, migration 0047 applied, seed complete.
- `pnpm db:types` → ran as part of `db:reset`; `result_remarks` present in `src/lib/db/types.ts`.

## Tests not run and why

- E2E — no Playwright spec added; out of packet scope as given.

## Limitations / honesty label

`RemarkDraftEditor` shows "AI draft — review before saving" + `ProviderBadge` — staff-editing view only. `ReportCard.tsx` (guardian/student-facing) shows the saved sentence with no AI/draft language, since a human already reviewed it before saving (rule 7 — docs/UI agree).

## Security / integration risks

- `saveResultRemark` deliberately avoids Postgrest upsert (see actions.ts comment) to keep the `created_by`-immutability guard trigger from firing on a legitimate cross-teacher edit of an existing remark.
- Scope check (`canDraftRemarkForResult`) duplicates the RLS predicate in TS, same precedent as `quiz-scope.ts` — RLS is the real enforcement either way.

## Follow-ups

None opened.

## New dependencies

None. (`src/components/ui/textarea.tsx` is a standard shadcn/ui primitive, not an npm dependency — matches the existing `Input`/`Select` components already in the stack.)

## Assumptions made

- Packet named `app.guardian_student_ids()`/`app.own_student_id()` for the SELECT policy, but current `results_select` (post-0035) uses `app.my_taught_student_ids()` + `app.my_student_ids()` (the P-01 initPlan rewrite that superseded the per-row helpers) — mirrored the *current* `results_select`, not the packet's literal function names, since that's what "mirror results_select's visibility exactly" requires after 0020/0035.
- Teacher write/read scope for a remark is "teaches this student in any subject of their enrolled section" (same shape as `app.my_taught_student_ids()`), not paper/subject-scoped like marks entry — one remark covers the whole result, not one paper.

## Fix round 1 (independent security review)

DB owner again this round: ran db:reset, test:db, test:security, test, lint, typecheck. No git.

### Files changed

- `supabase/migrations/20261028000048_result_remarks_updated_by.sql` (new) — LOW-1 only: drops/recreates `result_remarks_insert`/`result_remarks_update`, adding `r.superseded_by is null` to every EXISTS join against `results` (WITH CHECK only, matching this codebase's precedent of putting integrity checks there rather than duplicating into USING, e.g. 0026/0039). Kept the filename the coordinator gave even though no `updated_by` column was added (see MED-3 below) — the migration-number slot is what's reserved, not the slug.
- `src/modules/exams/actions.ts` — `saveResultRemark`: (1) the `results` lookup now also filters `is("superseded_by", null)` — app-layer mirror of 0048, turns a write against a stale version into a clean `not_found` instead of a raw RLS-violation error; (2) calls `audit(ctx, { action: "exam.remark.save", entityType: "result_remark", entityId, metadata: { resultId, created } })` on every save (create or edit) — actor + timestamp recorded via `record_audit_event`, remark text never included (no free-form user content in audit).
- `src/modules/exams/components/RemarkDraftEditor.tsx` — LOW-3: the `{studentLabel}` → real-name substitution is now `.slice(0, 500)` before `setRemark` (not just the textarea's `maxLength`, which only caps typed input, never a programmatic `setRemark`); Save is also disabled whenever `remark.length > 500` as a second gate, not only a non-empty check.
- `docs/planning/coolskool/07-security-and-ai-governance.md` — MED-5 (remarks row only): §4 service-role/definer table gets the `app.guard_result_remark_created_by` entry for 0047/0048 (same shape as `guard_assignment_created_by`, no new `security definer` function); §5 "Data flow" bullet now lists the report-card remark draft's allow-listed fields (exam name, overall grade/percentage, subject-wise marks/grade — never the student's name/admission no).
- `tests/db/result-remarks.test.ts` — two new cases: (a) MED-3 — teacher creates, principal overwrites, asserts `created_by` unchanged and exactly 2 `audit_events` rows with the correct `actor_user_id` each and no remark text in `metadata`; (b) LOW-1 — supersedes `resultA` with a new version (insert+update inside one `sql.begin` transaction, since `results_one_current_check` is a deferred constraint and the pair must commit together), asserts the action reports `not_found`, a direct RLS insert against the superseded row is also rejected, and the new current version is still writable.

### MED-3 decision: audit() over an `updated_by` column

Picked `audit()` — smaller change (no new column, no RLS/schema touch, `created_by`'s immutability guard is untouched) and `audit_events` already gives every write a real actor + timestamp. `updated_by` would have needed its own pin-at-write + no-immutability-requirement reasoning (it *should* change on every edit, unlike `created_by`) for no extra benefit over the audit trail.

### Tests run

- `pnpm vitest run tests/db/result-remarks.test.ts` → 4 passed (2 pre-existing + 2 new).
- `pnpm db:reset` → clean; 0048 applied; seed complete.
- `pnpm test:db` → 47 files, 316 tests: **1 pre-existing failure unrelated to this packet** — `tests/db/attendance-pattern-paging.test.ts` ("MED-4 regression", a different concurrent packet's untracked fixture file, touches `src/modules/attendance/queries.ts` only; `PostgresError: operator is not unique: unknown - unknown` in its own fixture SQL). Every `result_remarks`/exams test passes. Not fixed — outside this packet's scope (CLAUDE.md token rules: say so, don't fix another packet's file).
- `pnpm test:security` → 18 files, 1018 passed.
- `pnpm test` (unit) → 40 files, 430 passed.
- `pnpm lint` → clean.
- `pnpm typecheck` → clean.
- `src/lib/db/types.ts` — regenerated via `db:reset`; diff is additions-only (`result_remarks` row/insert/update/relationships), no column changes from 0048 (RLS-only migration).

### Follow-ups

- `tests/db/attendance-pattern-paging.test.ts`'s failure needs that packet's owner — not touched here.
