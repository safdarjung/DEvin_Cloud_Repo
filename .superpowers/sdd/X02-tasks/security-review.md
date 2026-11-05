# X02 security review — findings (pre-fix)

Reviewer is read-only. This file written before any fix, per workflow contract.

## HIGH

**docs/planning/coolskool/07-security-and-ai-governance.md §4, certificates definer row**

New X02 §4 row is materially wrong and self-contradicts DBT-66 in the same commit.

- Describes `public.issue_certificate(p_institution_id, p_student_id, p_kind, p_issued_by)`. Actual signature in `supabase/migrations/20261028000091_certificates.sql` is `public.issue_certificate(p_student_id uuid, p_kind text, p_purpose text default null, p_conduct text default null)` — no `p_institution_id`, no `p_issued_by` params (institution is looked up from the student row; `issued_by` is the caller's own `app.current_user_id()`, passed to `app.issue_certificate` as `p_actor`).
- Invents non-existent SQL functions `app.render_certificate` / `app.render_id_card`. Rendering is pure TS in `src/modules/certificates/certificate-html.ts` / `id-card-html.ts`, not SQL. No such function exists in 0091.
- States "Module-checked in SQL via 0091's `app.module_catalog` row for certificates; no additional TS gate needed." This is false: 0091 has no `app.module_enabled()` call anywhere. Module gating is enforced only in TS via `defineAction`/`defineQuery`'s `module: "certificates"` (guardedCall) — exactly as the X02 ruling ("Module gating is app-layer only: the RPC does not check it") and the newly-added DBT-66 row ("module gate app-layer only") both state.

Risk: a future reviewer trusting this table would wrongly conclude a disabled-module tenant is protected at the RPC/PostgREST layer, when it is not.

Fix: rewrite the row to match the actual signature/behavior and remove the false module-check claim.

## MEDIUM

**src/modules/certificates/certificate-html.ts — unescaped grade/section interpolation**

- Line ~198 (`renderBonafideHtml`): `const classLabel = enrolment ? \`${enrolment.grade}-${enrolment.section}\` : "—";` — not wrapped in `escapeHtml`, unlike every other field in this file.
- Line ~301 (transfer/TC table): `<td>${tc.grade}${tc.section ? \`-${tc.section}\` : ""}</td>` — same gap.

Both values come from admin-settable `grades.code` / `class_sections.name` columns. A grade or section name containing `<`/`>`/`"` breaks out of the markup. Violates the X02 ruling "Renderers are pure. They escape every interpolated string with `escapeHtml`."

Fix: wrap both in `escapeHtml(...)`.

## LOW

**src/modules/certificates/id-cards.queries.ts — non-deterministic truncation**

Active-enrolment query (`idCardsHtml`) orders only by `roll_no` (nulls last) before `.limit(ID_CARD_MAX)` on the Postgres side. The `first_name` tie-break (`sortEnrolments`) is applied client-side only *after* the DB-side cap. For a section with >60 students sharing the same `roll_no` value (most commonly multiple nulls), which 60 rows survive the Postgres-side truncation is non-deterministic — the printed card set can vary between otherwise-identical requests. Self-flagged as an assumption in `.superpowers/sdd/X02-tasks/task-9-report.md`.

Fix: add a secondary `.order("first_name", { referencedTable: "students" })` (or equivalent) before `.limit()` so truncation is deterministic.

**docs/planning/coolskool/10-backlog-index.md — X02-T12 doc task incomplete**

X02-T12's ACCEPT line requires updating §3's 0091 fragment to "→ built", but the diff only flips the neighboring X06 (0088) fragment to "built"; the 0091/certificates fragment text is unchanged (still reads "claimed 2026-11-02 ... directive named 0086, already held by X03" with no built marker).

Fix: update the 0091 fragment to say built, matching the 0088 pattern.

**src/modules/certificates/id-card-html.ts — formatPhoneIN no digit validation**

`formatPhoneIN` takes `phone.slice(-10)` and splits 5/5 without validating digit count or stripping non-digit characters. An existing `+91 ` prefix or spaces in the stored `guardians.phone` value shifts the output. Not a security issue (output is still escaped before interpolation) but a correctness risk if `guardians.phone` isn't stored as a bare 10-digit string.

Fix: strip non-digit characters before slicing.

---

## Outcomes (post-fix)

- **HIGH (07-security-and-ai-governance.md §4 definer row):** fixed. Rewrote the row with the real `public.issue_certificate(p_student_id, p_kind, p_purpose, p_conduct)` / `app.issue_certificate` signature and actor/institution resolution, replaced the invented `app.render_certificate`/`app.render_id_card` SQL functions with the real TS renderers, and replaced the false "module-checked in SQL" claim with an explicit statement that 0091 never calls `app.module_enabled()` and the gate is TS-only (`defineAction`/`defineQuery` `module: "certificates"`), matching DBT-66 and the exam_seating (X06) row above it.

- **MEDIUM (certificate-html.ts unescaped grade/section):** fixed. Wrapped `enrolment.grade`/`enrolment.section` (bonafide `classLabel`) and `tc.grade`/`tc.section` (TC table) in `escapeHtml`. Found during the fix: `tc.grade` is `z.string().nullable()` in `CertificateSnapshotSchema` (unlike `enrolment.grade`, which is non-nullable) — a bare `escapeHtml(tc.grade)` crashes with `TypeError: Cannot read properties of null (reading 'replace')` on a TC with no grade recorded, caught by `tests/db/certificates-acceptance.test.ts` (500 instead of 200). Used `escapeHtml(tc.grade ?? "")` to match the file's existing nullable-field pattern (e.g. `admitted_on ?? ""`). Added unit tests: HTML-injection in bonafide class label, HTML-injection in TC class-last-studied, and a null-TC-grade case (unit tests alone didn't exercise a null `tc.grade` fixture; the DB acceptance test did).

- **LOW (id-cards.queries.ts non-deterministic truncation):** fixed. Added `.order("students(first_name)", { ascending: true })` before `.limit(ID_CARD_MAX)`. Note for reviewers: the more obviously-named `.order("first_name", { referencedTable: "students" })` option that `@supabase/supabase-js` 2.118.0 exposes does **not** reorder the parent (`enrolments`) rows — per PostgREST's own docs, that form only reorders the embedded resource's rows, with no effect on which parent rows survive `.limit()`, and `!inner` does not change this. The form that does reorder the parent is the to-one-embed syntax `order=<relation>(<column>).<direction>`, passed to supabase-js as `.order("students(first_name)", {...})` with no `referencedTable` option. Verified by direct `curl` against the local PostgREST (v16.5) with both forms before settling on this one. Added a DB test: 65 students sharing `roll_no = null`, asserting the kept 60 are deterministic across two concurrent requests and are the first 60 alphabetically.

- **LOW (10-backlog-index.md X02-T12 doc task incomplete):** fixed. Updated the `0091` fragment's "claimed 2026-11-02" to "built", matching the `0088`/X06 pattern per X02-T12's ACCEPT line.

- **LOW (id-card-html.ts formatPhoneIN no digit validation):** fixed. `phone.replace(/\D/g, '').slice(-10)` strips non-digit characters (an existing `+91` prefix, spaces, hyphens) before taking the last 10 digits. Added a unit test covering a `+91 `-prefixed, a `+91`-prefixed-no-space, and a hyphenated input.

Tests run: `pnpm test tests/unit/certificate-html.test.ts tests/unit/id-card-html.test.ts tests/unit/certificates-schemas.test.ts` → 77 passed. `pnpm test:db tests/db/certificates-rls.test.ts tests/db/certificates-issue-rpc.test.ts tests/db/certificates-actions.test.ts tests/db/certificates-queries.test.ts tests/db/certificates-id-cards.test.ts tests/db/certificates-acceptance.test.ts tests/db/seed-certificates.test.ts tests/db/api-query-route.test.ts` → 8 files, 41 passed. `pnpm lint` → clean. `pnpm typecheck` → clean.

No findings skipped.
