# X02 — Certificates + student ID cards

Source: owner directive 2026-11-02 (extension milestone X02, plug-and-play module; approved 2026-11-02). Migration `0091` (claimed; the directive named 0086, already held by X03 library, and 0087–0090 are held by X04–X07). No new deps. New owning module `src/modules/certificates` (owns `certificates`). Module key **`certificates`** (category People & HR, default on, no `requires`). Reads students, guardians, enrolments, sections, documents and M14's `student_lifecycle_events` through RLS only; writes only its own table through 0091's definer. Fixtures replaced: none (`demoApprovals` kind `tc` is dropped by M16, not replaced here). No pages or nav (UI is Workstream D).

**Prereqs merged before T2 starts:** MOD (catalog, `module` on definitions, `0084` `app.module_enabled`); M14 T2–T6 (`0076` `student_lifecycle_events` + `exit_student` + `lifecycle.withdraw`); M11 T9–T10 (`escapeHtml` in `src/modules/exams/report-card-html.ts`, `src/lib/http/html.ts` `toHtmlResponse`, `?format=html`). M05 documents is built.

Rulings:
- **Module.** T1 adds `certificates` to `MODULES` (after `student_lifecycle`); the settings schema picks it up through `OPTIONAL_MODULE_KEYS`. Every definition declares `module: "certificates"`. `tests/security/module-gate.test.ts` covers the new names with no edit. Module gating is app-layer only: the RPC does not check it (MOD ruling; debt row).
- **`app.module_catalog` insert (0091).** 0091 inserts `certificates` (`default_enabled = true`) via `insert into app.module_catalog (key, default_enabled) values ('certificates', true) on conflict (key) do update set default_enabled = excluded.default_enabled`. `app.module_enabled` (MOD, 0084) is defined once and is never redefined here.
- **Table `certificates`** (append-only, rule 5 extended): `id uuid pk default gen_random_uuid()`, `institution_id → institutions not null`, `student_id → students not null`, `kind text not null check in ('bonafide','character','transfer')`, `serial_no text not null check (length between 1 and 60)`, `lifecycle_event_id uuid → student_lifecycle_events null`, `snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')`, `issued_by uuid not null → profiles`, `issued_at timestamptz not null default now()`, `created_at`/`updated_at` + `app.set_updated_at`. Check `(kind = 'transfer') = (lifecycle_event_id is not null)`. Unique `(institution_id, serial_no)`; partial unique `(lifecycle_event_id) where lifecycle_event_id is not null`; index `(institution_id, student_id, issued_at desc)`. `app.block_mutation` BEFORE UPDATE OR DELETE (passes only under `app.allow_reset`, i.e. demo reset).
- **RLS** (07 §2.2, lesson 7 initPlan): SELECT `certificates_select` = `institution_id = any((select app.my_institution_ids(array['owner','principal','admin','admissions'])))`. No INSERT/UPDATE/DELETE policy: rows come only from 0091's definer (or the seed over direct Postgres). Grants as 0076 (select to `authenticated`). `tests/security/rls-expectations.ts` entry: read = those 4 roles, `write: []`. Guardians/students get no access (they hold the paper copy; skipped).
- **Kinds and issue guards** (SQL, raise `code:*`):
  - `bonafide`: student `status = 'active'` with an `active` enrolment, else `invalid_state`. `purpose` required, trimmed 3–200. `conduct` must be null.
  - `character`: any student status, at least one enrolment, else `invalid_state`. `conduct` required, trimmed 2–100 (e.g. "Good"). `purpose` optional, 3–200.
  - `transfer`: student `status = 'withdrawn'` with a `student_lifecycle_events` row of kind `transferred_out|withdrawn` (latest by `created_at`), else `invalid_state`. `purpose` and `conduct` must be null (TC fields come from the event). One TC certificate per event: a repeat call returns the existing row with `created: false`, writes nothing, audits nothing.
  - Other input violations → `validation_failed`. No cancel/void and no "duplicate" marking (debt).
- **Serial numbers.** `bonafide` / `character`: `app.next_sequence(inst, 'bonafide_no' | 'character_no')`. That gives gap-free, row-locked, per-institution numbers. If `settings.numbering.<key>` is missing, first merge the default `BON/{YYYY}/{SEQ:5}` / `CHR/{YYYY}/{SEQ:5}` into `settings.numbering` (M14 `tc_no` precedent). Sequences are continuous (never reset per year, like `admission_no` and `tc_no`). `transfer`: serial = the event's `tc_no` (M14 already allocated it; no second TC series). A custom pattern that collides across kinds → 23505 → `conflict`.
- **SQL functions (0091).**
  - `app.issue_certificate(p_actor uuid, p_student_id uuid, p_kind text, p_purpose text, p_conduct text) returns jsonb` — `security definer`, `search_path = ''`. Institution comes from the student row. No role check (callers: the public wrapper, and the seed over `ctx.sql`, `finance.ts` precedent). Runs the guards above, serial, snapshot, insert with `issued_by = p_actor`, `app.audit` event `certificate.issued` with `{certificate_id, kind, serial_no}` only (no purpose/conduct text, lesson 10). Returns `{certificate_id, serial_no, created}`. `revoke execute … from public, anon, authenticated`.
  - `public.issue_certificate(p_student_id uuid, p_kind text, p_purpose text default null, p_conduct text default null) returns jsonb` — definer, same `search_path`. Null uid → `unauthenticated`. Student missing → `not_found`. Caller without an active owner/principal/admin/admissions membership on the student's institution (`app.has_role`) → `forbidden`. Then calls `app.issue_certificate(auth.uid(), …)`. `revoke … from public, anon`; `grant execute … to authenticated`. Listed in 07 §4 (T12).
- **Snapshot** (lesson 3: built in SQL from rows; the caller supplies only `purpose`/`conduct` text). Exact keys: `{kind, serial_no, issued_on (institution-local date, tz = settings.locale.timezone, fallback Asia/Kolkata), issued_by_name (profiles.full_name), school: {name, board, address}, student: {name (first + ' ' + last), admission_no, dob, gender, status}, guardian: {name, relationship} | null (primary, else earliest linked), enrolment: {grade (grades.code), section (class_sections.name), academic_year (academic_years.name), roll_no, status} | null (latest by started_on), admitted_on (earliest enrolment started_on), purpose, conduct, tc}`. `school.address` = `nullif(concat_ws(', ', address->>'line1', address->>'line2', address->>'city', address->>'state', address->>'pincode'), '')`. `tc` = the event's `tc_snapshot` verbatim for `transfer`, else null. The TC renderer takes its pupil fields from `tc` (frozen at exit).
- **Printing.** HTML via the query dispatcher `?format=html` (M11 `toHtmlResponse`: `null` → 404 `not_found`). Renderers are pure. They escape every interpolated string with M11's `escapeHtml`. Inline print CSS, no scripts, no external URLs, English only. Header: school name, board, address when set, and a CSS monogram (initials) in place of a logo. Signature lines are left blank ("Class teacher", "Principal (signature & seal)"); no digital signature. A reprint renders the same frozen snapshot.
- **India specifics.** Dates `DD-MM-YYYY`. DOB also in words on bonafide and TC ("Fifteenth August Two Thousand Twelve"). Money `en-IN` INR (`₹1,23,456.00`). Relation phrase: male → "son of", female → "daughter of", else "ward of". A guardian relationship of `legal_guardian|grandparent|other` → "ward of". TC = CBSE-style numbered fields, including the dues line ("Yes" / "No — ₹x outstanding" from `tc.dues_outstanding`). Phones `+91 98000 00001`. Photo cap = the Indian form-photo norm of 20–50 KB.
- **ID cards** (`certificates.idCardsHtml` {classSectionId}): one card per `active` enrolment of the section, ordered `roll_no` nulls last then `first_name`, at most 60 (footer "showing 60 of N" beyond). Card fields: school name + monogram, session (academic year name), photo, student name, admission no, class `<grade code>-<section name>`, DOB, guardian phone (primary guardian, else earliest linked), "If found, please return to <school>". Size CR80 85.6 × 54 mm, 2 per row on A4, `break-inside: avoid`. No issue record, no serial, no audit (read-only query; debt row).
- **Photo.** Use the newest `documents` row with `entity_type = 'student'`, `kind = 'photo'`, `status = 'active'` and mime `image/jpeg|image/png`, read with the caller's client (RLS; no service role). Embed it as `data:<mime>;base64,…`, downloaded with `storage.from('tenant-docs').download(path)` by the caller's client, and only when `size_bytes ≤ 51200`. This keeps a 60-card page under Vercel's 4.5 MB response cap. A larger photo or a failed download → initials placeholder, with the footer "N photos over 50 KB not shown — upload a 20–50 KB JPEG". No signed URL leaves the server. The renderer accepts only `^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$`. `toHtmlResponse`'s CSP gains `img-src data:` (T6).
- **Permission.** `certificate.manage` = owner, principal, admin, admissions (issue, list/verify, print, ID cards). It is the same role set as `student.write` and as documents' admissions scope. The RPC re-checks it. 07 §2.2 row (T1).
- **Names.** Action `certificate.issue`. Queries `certificates.list`, `certificates.printHtml`, `certificates.idCardsHtml`. All take permission `certificate.manage` and `module: "certificates"`.
- **Verification.** `certificates.list` {serialNo} = exact (trimmed) match → 0 or 1 row; staff use it to confirm a presented certificate. No public or QR verification (skipped).
- **ErrorCode map:**
  - `unauthenticated`: null uid in the RPC.
  - `forbidden`: permission, module, RPC role check, `42501`.
  - `not_found`: student missing; certificate or section not visible (HTML query `null` → 404).
  - `validation_failed`: Zod; purpose/conduct/kind rules in SQL.
  - `invalid_state`: student state does not fit the kind; `block_mutation`.
  - `conflict`: raw `23505` (concurrent TC issue, serial collision).
  - `internal`: a snapshot that fails `CertificateSnapshotSchema` (`AppError`, no SQL text).
  - RPC `code:*` → `mapSqlError`. Raw PostgREST codes are mapped in the action.
- **Honesty.** No simulated channel; printing is real. Docs: feature `limited` (HTML print / browser Save as PDF; no logo upload, no digital signature, English only, no guardian copy). The UI pass shows `<LimitedBadge>` "Print view — sign and seal by hand" and labels the button "Print / Save as PDF (browser)".

Routing: T1 haiku none [] ; T2 sonnet exclusive [1] ; T3 sonnet exclusive [2] ; T4 haiku none [] ; T5 haiku none [4] ; T6 haiku none [5] ; T7 sonnet tests [1,3,4] ; T8 sonnet tests [1,3,4,5] ; T9 sonnet tests [6,8] ; T10 sonnet tests [7,8,9] ; T11 sonnet exclusive [3] ; T12 haiku none [10,11]

T2–T3 edit the one unmerged 0091 file and run `db:reset`/`db:types`, so they run strictly in order. T1 adds the catalog key before T2's SQL exists: the controller commits T1 together with T2, because `tests/db/module-enabled-sql.test.ts` is red in between. Every new action: `all-actions.ts` line + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `query-defs.ts` + `all-queries.ts` + smoke sample in `tests/db/api-query-route.test.ts`. Seed-imported files: relative `.ts` imports only. Shared files (`permissions.ts`, `catalog.ts`, registries, `html.ts`) take additive edits only.

---

### Task 1: X02-T1 Permission `certificate.manage` + module key `certificates` (Haiku)
READ: BRIEF-COMMON.md; rulings (Module, Permission); `src/lib/modules/catalog.ts`; `tests/unit/modules-catalog.test.ts`; commit `4e6542b` (M07-T1, same shape)
FILES: `src/lib/auth/permissions.ts`; `src/lib/modules/catalog.ts` (one entry); `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (one row after `leave.approve`: `certificate.manage (issue/verify/print certificates + ID cards; staff-only table)` — own ✓ · pri ✓ · adm ✓ · ads ✓); `tests/unit/permissions.test.ts`; `tests/unit/modules-catalog.test.ts`
MIGRATION: none (T2 inserts into `app.module_catalog`)
EXPORTS: `"certificate.manage"` in `Permission`, granted to owner, principal, admin, admissions. `MODULES.certificates = { label: "Certificates & ID cards", category: "People & HR", description: "Issue bonafide, character and transfer certificates with serial numbers, and print student ID cards.", default: true }`.
TEST FIRST: the 4 roles hold `certificate.manage`; accountant, exam_controller, teacher, student, guardian do not; `certificates` is on by default; `{modules: {certificates: false}}` parses and turns it off; `allModulesOn()` includes it; any key-count assertion goes up by 1.
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts tests/unit/modules-catalog.test.ts tests/unit/institution-settings.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: X02-T2 Migration 0091 part 1 — `certificates` table, RLS, guards, module key (Sonnet, DB owner)
READ: BRIEF-COMMON.md (lessons 1, 2, 4, 5, 7); rulings; the `app.module_catalog` definition (0084, MOD); `…0076_student_lifecycle.sql` (append-only table, SELECT shape, grants); `tests/db/module-enabled-sql.test.ts`
FILES: `supabase/migrations/20261028000091_certificates.sql` (new); `tests/db/certificates-rls.test.ts` (new); + `src/lib/db/types.ts` (regen), `tests/security/rls-expectations.ts` (one entry)
MIGRATION: `20261028000091_certificates.sql` (claimed)
EXPORTS: `insert into app.module_catalog (key, default_enabled) values ('certificates', true) on conflict (key) do update set default_enabled = excluded.default_enabled`; table, checks, indexes, triggers, RLS and grants per rulings.
TEST FIRST: drift test green for `certificates` (default on, stored false → off); a postgres-inserted row is readable by owner/principal/admin/admissions and returns [] for accountant, teacher, guardian and student; admin of institution B sees none of A's rows; authenticated INSERT → denied; postgres UPDATE/DELETE → `invalid_state`, and passes under `set_config('app.allow_reset','on',true)`; `transfer` without `lifecycle_event_id` → 23514; duplicate serial in one institution → 23505, while the same serial in another institution is accepted.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/certificates-rls.test.ts tests/db/module-enabled-sql.test.ts`; `pnpm test:security` (expectations updated — say so); `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: X02-T3 Migration 0091 part 2 — `issue_certificate` (Sonnet, DB owner)
READ: BRIEF-COMMON.md (lessons 3–5, 8, 10); rulings (Kinds, Serial numbers, SQL functions, Snapshot); T2 migration; `…0076_student_lifecycle.sql` `exit_student` (numbering merge, role check, `app.audit`); `…0001_foundation.sql` `app.next_sequence`
FILES: `supabase/migrations/20261028000091_certificates.sql` (append); `tests/db/certificates-issue-rpc.test.ts` (new); + types regen
MIGRATION: 0091 (same file)
EXPORTS: `app.issue_certificate(...)`, `public.issue_certificate(...)` per rulings, with revokes/grants.
TEST FIRST:
- Admissions issues a bonafide for an active student → `BON/<YYYY>/00001`; the next one → `…00002`; `settings.numbering.bonafide_no` is merged in. Snapshot name, admission no, class, year and guardian come from rows; `purpose` is stored.
- Character with conduct "Good" → `CHR/<YYYY>/00001`.
- Bonafide without purpose → `validation_failed`; bonafide for a withdrawn student → `invalid_state`.
- After `exit_student`, transfer → serial = the event's `tc_no`, `snapshot.tc` = the event snapshot, `lifecycle_event_id` set. A second transfer call → same id, `created: false`, row count unchanged.
- Transfer for an active student → `invalid_state`; transfer with a purpose → `validation_failed`.
- Teacher and accountant → `forbidden`; unknown student → `not_found`.
- The audit row holds ids, kind and serial only.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/certificates-issue-rpc.test.ts`; `pnpm test:security tests/security/grants.test.ts` (update expectations if needed — say so); `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: X02-T4 Certificates Zod schemas (Haiku)
READ: BRIEF-COMMON.md; rulings (Kinds, Snapshot, Names); `src/modules/timetable/schemas.ts`, `src/lib/schemas/common.ts`
FILES: `src/modules/certificates/schemas.ts` (new, relative `.ts` imports); `tests/unit/certificates-schemas.test.ts` (new)
MIGRATION: none
EXPORTS:
- `CertificateKindSchema`.
- `IssueCertificateSchema` = `z.discriminatedUnion("kind", …)`: bonafide {studentId, purpose trim 3–200}; character {studentId, conduct trim 2–100, purpose? trim 3–200}; transfer {studentId}. Each `.strict()`.
- `CertificateListSchema` {studentId?, serialNo? trim 1–60, kind?, limit int 1–100 default 50}; `CertificatePrintSchema` {certificateId}; `IdCardsSchema` {classSectionId}. All strict.
- `CertificateSnapshotSchema` (`z.looseObject`, keys per rulings).
- `TcSnapshotSchema` (`z.looseObject`: `left_on`, `reason`, `destination_school` nullable, `conduct` nullable, `dues_outstanding` `z.coerce.number()`, `kind`, plus the pupil fields the TC prints).
- Inferred types.
TEST FIRST: each kind parses; bonafide without purpose rejected; transfer with purpose rejected; conduct "G" rejected; `"  BON/2026/00001 "` trims; limit 101 rejected; a snapshot fixture per kind parses and keeps an unknown key.
ACCEPT: `pnpm test tests/unit/certificates-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: X02-T5 Certificate HTML renderer (Haiku)
READ: BRIEF-COMMON.md; rulings (Printing, India specifics); T4 types; `src/modules/exams/report-card-html.ts` (M11: `escapeHtml`, page CSS)
FILES: `src/modules/certificates/certificate-html.ts` (new, pure: `import type` + `escapeHtml` only); `tests/unit/certificate-html.test.ts` (new)
MIGRATION: none
EXPORTS:
- `formatDateIN(iso: string): string` (DD-MM-YYYY).
- `dateInWords(iso: string): string` (years 1900–2099).
- `relationPhrase(gender: string, relationship: string | null): "son of" | "daughter of" | "ward of"`.
- `formatInr(n: number): string`.
- `renderCertificateHtml(snapshot: CertificateSnapshot): string`:
  - Bonafide: "is a bonafide student … Class <grade>-<section> … session <year> … date of birth <DD-MM-YYYY> (<words>) … issued for <purpose>".
  - Character: "is/was a student … conduct and character have been <conduct>". Uses "is" when `student.status = 'active'`, "was" otherwise.
  - Transfer: numbered table: name, parent/guardian, DOB figures + words, admission no, date of admission, class last studied, date of leaving, reason, school transferred to (`transferred_out` only), conduct, dues cleared, date of issue.
  - Common parts: header (monogram, school, board, address), title, "Serial No." + date, signature lines, `@page { size: A4; margin: 15mm }`, no `<script`, no `http`.
TEST FIRST: a `<script>` student name is escaped; bonafide shows purpose and DOB in words; character says "is" for active and "was" for withdrawn; TC with `dues_outstanding` 1500 shows "No — ₹1,500.00 outstanding"; `dateInWords("2012-08-15")` = "Fifteenth August Two Thousand Twelve"; female + father → "daughter of"; grandparent → "ward of"; output has `@page` and no `<script`.
ACCEPT: `pnpm test tests/unit/certificate-html.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: X02-T6 ID card HTML renderer + CSP `img-src data:` (Haiku)
READ: BRIEF-COMMON.md; rulings (ID cards, Photo); `src/lib/http/html.ts` + `tests/unit/html-response.test.ts` (M11); T5 (`formatDateIN`)
FILES: `src/modules/certificates/id-card-html.ts` (new, pure); `src/lib/http/html.ts` (CSP string only); `tests/unit/id-card-html.test.ts` (new); `tests/unit/html-response.test.ts` (expected CSP)
MIGRATION: none
EXPORTS: `interface IdCard { name: string; admissionNo: string; dob: string; guardianPhone: string | null; photoDataUri: string | null }`; `formatPhoneIN(p: string): string` (`9800000001` → `+91 98000 00001`); `renderIdCardsHtml(input: { schoolName: string; board: string; academicYear: string; classLabel: string; cards: IdCard[]; totalStudents: number; photosSkipped: number }): string`. The photo renders only when it matches the rulings regex, else an initials placeholder. Footer notes when `totalStudents > cards.length` and when `photosSkipped > 0`. CSP becomes `default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'`.
TEST FIRST: one card per input; a `javascript:` or `https://` photo value → placeholder and no `<img`; a valid PNG data URI → `<img src="data:image/png;base64,`; name escaped; phone formatted; "showing 60 of 72" footer; the `toHtmlResponse` CSP contains `img-src data:`.
ACCEPT: `pnpm test tests/unit/id-card-html.test.ts tests/unit/html-response.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: X02-T7 Action `certificate.issue` (Sonnet)
READ: BRIEF-COMMON.md; rulings (ErrorCode map); T3 RPC; T4 schemas; `src/modules/lifecycle/actions.ts` (M14 RPC wrapper + raw-code mapping); `MOD-tasks.md` (how a test disables a module)
FILES: `src/modules/certificates/actions.ts` (new, `"use server"`); `tests/db/certificates-actions.test.ts` (new); + `src/app/api/v1/actions/all-actions.ts` line + C-03 fixture `{ studentId: <uuid>, kind: "bonafide", purpose: "Passport application" }`
MIGRATION: none
EXPORTS: `issueCertificate = defineAction({ name: "certificate.issue", module: "certificates", schema: IssueCertificateSchema, permission: "certificate.manage", handler })` → `{ certificateId: string; serialNo: string; created: boolean }`. The handler calls `rpc("issue_certificate", { p_student_id, p_kind, p_purpose: purpose ?? null, p_conduct: conduct ?? null })`. Errors: `code:*` → `mapSqlError`; raw `23505` → `conflict`; `42501` → `forbidden`. No TS audit (SQL audits).
TEST FIRST: admissions issues a bonafide → `BON/<YYYY>/00001`; character → `CHR/…`; transfer after `lifecycle.withdraw` → serial = its `tcNo`, repeat → `created: false`; bonafide for a withdrawn student → `invalid_state`; teacher → `forbidden`; `certificates` stored false → `forbidden` with `MODULE_DISABLED_MESSAGE` and no row.
ACCEPT: `pnpm test:db tests/db/certificates-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: X02-T8 Queries `certificates.list` + `certificates.printHtml` (Sonnet)
READ: BRIEF-COMMON.md; rulings (Verification, Printing); T4, T5; `src/modules/exams/query-defs.ts` (`exams.reportCardHtml`, M11 HTML def); `src/modules/lifecycle/queries.ts` + `query-defs.ts` (pattern)
FILES: `src/modules/certificates/queries.ts` (new, `server-only`); `src/modules/certificates/query-defs.ts` (new); `tests/db/certificates-queries.test.ts` (new); + `src/app/api/v1/query/all-queries.ts` line + 2 smoke samples
MIGRATION: none
EXPORTS:
- `CertificateRow { id; kind; serialNo; studentId; studentName; admissionNo; classLabel; issuedOn; issuedAt; issuedByName; purpose: string | null; conduct: string | null }` (columns + snapshot).
- `listCertificates(ctx, filters): Promise<CertificateRow[]>`: RLS is the only filter, plus `.eq('institution_id', ctx.institution.id)`; order `issued_at desc`; `limit`.
- `certificateHtml(ctx, certificateId): Promise<{ html: string } | null>`: row not visible → `null`; snapshot fails the schema → `AppError("internal")`.
- Defs `certificates.list` (`CertificateListSchema`) and `certificates.printHtml` (`CertificatePrintSchema`): `certificate.manage`, module `certificates`. No fixtures imported.
TEST FIRST (rows via `app.issue_certificate` over `sql`): list by studentId is newest first; `serialNo` exact → 1 row, unknown → []; kind filter; accountant → `forbidden`; printHtml → `{ html }` with the student name and serial; another institution's certificate id → `null`.
ACCEPT: `pnpm test:db tests/db/certificates-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 9: X02-T9 Query `certificates.idCardsHtml` (Sonnet)
READ: BRIEF-COMMON.md; rulings (ID cards, Photo); T6 renderer; T8 files; `src/modules/documents/actions.ts` (caller-client storage use); `tests/db/documents-read-actions.test.ts` (upload helper)
FILES: `src/modules/certificates/id-cards.queries.ts` (new, `server-only`); `src/modules/certificates/query-defs.ts` (1 def); `tests/db/certificates-id-cards.test.ts` (new); + smoke sample
MIGRATION: none
EXPORTS:
- `ID_CARD_MAX = 60`, `ID_CARD_PHOTO_MAX_BYTES = 51200`.
- `idCardsHtml(ctx, classSectionId): Promise<{ html: string } | null>`, in this order:
  1. Section + grade + academic year via RLS; not visible → `null`.
  2. Active enrolments (ordering per rulings, `count: "exact"`, `limit(ID_CARD_MAX)`) and their students.
  3. Guardian phones (`guardian_students` `is_primary desc, created_at`).
  4. Photo docs: one `.in('entity_id', ids)` select, newest per student.
  5. `Promise.all` downloads for rows within the cap, then `Buffer.from(await blob.arrayBuffer()).toString("base64")`.
  6. Render.
- Def `certificates.idCardsHtml` (`IdCardsSchema`, `certificate.manage`, module `certificates`).
TEST FIRST: a section with 3 active students → 3 cards with admission nos and guardian phones; a student with an uploaded 1 KB PNG `photo` doc → `data:image/png;base64,` on that card and placeholders on the others; a 60 KB photo → placeholder + "over 50 KB" footer; a withdrawn student's card is absent; another institution's section → `null`; teacher → `forbidden`.
ACCEPT: `pnpm test:db tests/db/certificates-id-cards.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 10: X02-T10 Acceptance over HTTP (Sonnet)
FILES: `tests/db/certificates-acceptance.test.ts`
TEST:
- Admissions `POST /api/v1/actions/certificate.issue` bonafide → 200 + serial; the same request again → the next serial.
- `GET /api/v1/query/certificates.printHtml?format=html` → 200 `text/html`; the CSP header contains `img-src data:`; the body contains the student name and serial.
- `certificates.list` {serialNo} → exactly that certificate (verification).
- Admin `lifecycle.withdraw` → `certificate.issue` transfer → serial = `tcNo`; repeat → `created: false`; its printHtml shows the destination school.
- `certificates.idCardsHtml?format=html` for the section → 200 with every admission no.
- Teacher `certificate.issue` → 403; guardian `certificates.list` → 403; module stored false → 403 on the action and on a query; unknown certificate id → 404.
ACCEPT: `pnpm test:db tests/db/certificates-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 11: X02-T11 Seed section `certificates` (Sonnet, seed owner)
READ: BRIEF-COMMON.md; rulings; `scripts/seed/index.ts`, `scripts/seed/sections/finance.ts` (calling `app.*` over `ctx.sql`); `05-data-architecture.md` §8.1 (named students, principal user); `tests/db/seed-timetable.test.ts`
FILES: `scripts/seed/sections/certificates.ts` (new); `scripts/seed/index.ts` (register last); `tests/db/seed-certificates.test.ts` (new)
MIGRATION: none
EXPORTS: over `ctx.sql`, `app.issue_certificate` with `p_actor` = the demo principal, in this order:
1. bonafide for Aarav Sharma (purpose "Passport application");
2. bonafide for Ananya Sharma ("Scholarship application");
3. character for Ananya Sharma (conduct "Very good").
Serials are `BON/<YYYY>/00001`, `BON/<YYYY>/00002`, `CHR/<YYYY>/00001`. No TC (the seed has no exited student) and no photos. If `app.demo_reset` keeps `institution_sequences`, say so in the report; do not hand-edit sequences.
TEST FIRST: the demo tenant has exactly those 3 certificates with those serials and student names in the snapshots; reseed gives the same (student, kind, serial) triples.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset`; `pnpm test:db tests/db/seed-certificates.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 12: X02-T12 Docs (Haiku)
FILES:
- `docs/planning/coolskool/03-feature-matrix.md`: one row after F-STU-11, using the next free F-STU id. Feature "Certificates (bonafide, character, TC) with serial numbers + bulk student ID cards". Phase 2. Demo `limited (API + HTML print; no logo, no digital signature, English only)`. Pri P2. Deps F-STU-07, F-STU-08. Owner certificates. Sens conf. Accept `tests/db/certificates-acceptance.test.ts`.
- `docs/planning/coolskool/05-data-architecture.md`: §2 row `certificates`; §3 ownership row `certificates | certificates | people, academics, documents, lifecycle`; §8.1 line for the 3 seeded certificates; note "student photo = `documents` kind `photo`, 20–50 KB JPEG/PNG".
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4: definer row (`public.issue_certificate` → `app.issue_certificate`; `app.module_catalog` insert in 0091).
- `docs/planning/coolskool/12-decision-log.md` §Debt: no cancel/void or duplicate marking; no logo upload; ID-card photo reads not audited; no guardian/student copy; no public/QR verification; English only; module gate app-layer only.
- `docs/planning/coolskool/10-backlog-index.md` §3: `0091` fragment only → built.
ACCEPT: rows match the merged code; no other files touched; `pnpm lint`
REPLACES FIXTURE: none

---

Controller after T11: security review (Sonnet) on the 0091 diff, the action and the 3 queries (RLS, definer, HTML/CSP, photo embedding); full gate; `pnpm db:reset` + `pnpm seed` clean; commit/push; hosted push of 0091 owner-run (the hosted demo needs a reseed of the `certificates` section only); `DONE X02 <sha>`.

Skipped (smallest version):
- Logo upload: needs a documents `institution` entity type, which changes the 0067/0071/0077 policies. A monogram is shown instead.
- Cancel/void and "duplicate copy" reprints.
- Guardian/student portal copy.
- Public QR verification.
- Hindi/bilingual text; PDF output (browser print only).
- Template editor; other kinds (migration, sports, fee, study).
- Staff ID cards; blood group and address on cards (no columns).
- Server-side photo resizing (no image dep); seeded photos and a seeded TC.
- Audit of ID-card prints.
