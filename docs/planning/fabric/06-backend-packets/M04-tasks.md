# M04 — CSV import / export (the 3-day onboarding path)

Source: `07-master-plan-v1-v2.md` §3 M4. Migration `0066` (claimed). New dep `papaparse` (+ `@types/papaparse` dev) — quoting-correct CSV, no std-lib CSV in Node (plan-approved). New owning module `src/modules/imports` (owns `import_batches`, `import_rows`).

Rulings (recorded in the ledger):
- Scope: students (+ guardian + link + enrolment) and staff. Fee-structure and marks CSV import are deferred (DBT-44): both already have batch actions (`finance.structure.upsert`, `exam.marks.enter` ≤ 60 rows) and ~10/≤ 60 rows per school/paper.
- New permission `data.import` = owner/principal/admin. `data.export` not added: `?format=csv` returns exactly what the JSON query returns, gated by the query's own permission.
- Commit runs in one SQL function, **security invoker** — every write goes through the caller's RLS (students/guardians/enrolments insert = owner/principal/admin/admissions; staff = owner/principal/admin), so a PostgREST caller who writes `import_rows` directly gains nothing they couldn't insert directly. Each row in its own `begin … exception` block: a bad row is marked with its error, the rest commit.
- Idempotency: students on `(institution_id, admission_no)`, guardians on `(institution_id, phone)`, staff on `(institution_id, employee_no)` — existing rows are `skipped`, never updated. Re-committing a committed batch returns its stored counts and writes nothing.

Every new action: register via its file's import in `src/app/api/v1/actions/all-actions.ts` and add a C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `src/modules/imports/query-defs.ts` + `src/app/api/v1/query/all-queries.ts`. Files imported by seed scripts must not use `@/`.

Order: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8.

---

### Task 1: M04-T1 Permission `data.import`
READ: BRIEF-COMMON.md; `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (matrix table)
FILES: `src/lib/auth/permissions.ts` (edit); `tests/unit/permissions.test.ts` (edit); `docs/planning/coolskool/07-security-and-ai-governance.md` (edit: one matrix row)
EXPORTS: `"data.import"` in the `Permission` union and in owner, principal, admin lists only.
TEST FIRST: "data.import is held by exactly owner, principal, admin".
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 2: M04-T2 Migration 0066 part 1 — import tables + RLS
READ: BRIEF-COMMON.md lessons 1, 2, 7; `supabase/migrations/20261028000064_onboarding.sql` (style); 0002 `app.set_updated_at`
FILES: `supabase/migrations/20261028000066_imports.sql` (new — tables + RLS only; T3 appends the function to the same unpushed file); `tests/db/imports-rls.test.ts` (new); `src/lib/db/types.ts` (regen)
EXPORTS: `public.import_batches` (id, institution_id → institutions, entity_type text check in ('students','staff'), status text default 'staged' check in ('staged','committed'), file_name text check length ≤ 200, row_count/valid_count/error_count/committed_count/skipped_count int not null default 0, created_by → profiles, committed_by → profiles, committed_at, created_at, updated_at); `public.import_rows` (id, batch_id → import_batches, institution_id, row_no int not null, data jsonb not null, errors jsonb, status text check in ('valid','invalid','committed','skipped'), entity_id uuid, created_at, updated_at; unique (batch_id, row_no)); indexes on (institution_id), (batch_id). RLS on both: SELECT/INSERT/UPDATE for `app.has_role(institution_id, array['owner','principal','admin'])`; import_rows INSERT/UPDATE `with check` binds `batch_id` to a batch of the same institution (table-qualified). No DELETE policies. `set_updated_at` triggers.
TEST FIRST: admin inserts a batch + rows → ok; teacher/admissions cannot read or insert; admin of A cannot add a row to B's batch; guardian sees nothing.
ACCEPT: `pnpm test:db tests/db/imports-rls.test.ts`; `pnpm test:security` (update RLS expectations if the generated suite needs the new tables — say so); `pnpm lint`; `pnpm typecheck`

### Task 3: M04-T3 Migration 0066 part 2 — `commit_import_batch`
READ: BRIEF-COMMON.md; Task 2 tables; students/guardians/guardian_students/enrolments DDL (0004/0005) and 0036 binding; rulings above
FILES: `supabase/migrations/20261028000066_imports.sql` (append); `tests/db/imports-commit.test.ts` (new); `src/lib/db/types.ts` (regen)
EXPORTS: `public.commit_import_batch(p_batch_id uuid) returns jsonb` — **security invoker**, `search_path=''`, `execute` to authenticated only. Locks the batch (`for update`); unknown/hidden → `code:not_found`; caller lacks owner/principal/admin → `code:forbidden`; status `committed` → return stored counts, no writes. For each `valid` row by row_no, in its own exception block: **students** — `data` keys `admission_no, first_name, last_name, dob, gender, class_section_id, academic_year_id, roll_no, guardian_name, guardian_phone, guardian_email, guardian_relationship`; existing admission_no → row `skipped`; else insert student, guardian by phone (reuse if exists), `guardian_students` (is_primary when the student has none), active enrolment (`started_on` = current_date) → row `committed`, `entity_id` = student id. **staff** — keys `employee_no, full_name, designation, department_id, phone, email, is_teaching`; existing employee_no → `skipped`; else insert → `committed`. Any exception → row `invalid`, `errors = jsonb_build_array(sqlerrm-free message)` (map unique/check violations to a short fixed text; never echo row data). Then batch status `committed`, counts, committed_by/at; one `app.audit` row with counts only. Returns `{committed, skipped, invalid}`.
TEST FIRST: 3 valid + 1 duplicate admission_no → 3 committed, 1 skipped; a row with a bad phone → invalid with error, others commit; recommit → same counts, no new students; teacher → forbidden; staff batch commits staff; guardian reused by phone across two students.
ACCEPT: `pnpm test:db tests/db/imports-commit.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`

### Task 4: M04-T4 CSV parse + row schemas (+ dep)
READ: BRIEF-COMMON.md; papaparse 5.x API (Context7 or `node_modules/papaparse` d.ts after install); `src/lib/schemas/common.ts`
FILES: `package.json` + `pnpm-lock.yaml` (`pnpm add papaparse` and `pnpm add -D @types/papaparse`); `src/modules/imports/schemas.ts` (new); `tests/unit/imports-schemas.test.ts` (new)
EXPORTS: `parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] }` (header row required, trims headers/cells, skips empty lines, throws `AppError("validation_failed")` on > 5000 rows or a parse error); `STUDENT_COLUMNS` / `STAFF_COLUMNS` (template header order); `StudentImportRowSchema` (admission_no 1–40, first_name 1–80, last_name ≤ 80 optional, dob ISO date, gender male|female|other, grade 1–20, section 1–20, roll_no optional int 1–999, guardian_name 1–120, guardian_phone `^[6-9][0-9]{9}$` after stripping spaces/dashes/+91, guardian_email optional email, guardian_relationship father|mother|legal_guardian|grandparent|other); `StaffImportRowSchema` (employee_no 1–40, full_name 1–120, designation 1–80, department optional ≤ 80, phone optional same rule, email optional, is_teaching yes|no → boolean); `StageImportSchema` ({ entityType: students|staff, fileName ≤ 200, csv string ≤ 1 MB }); `CommitImportSchema` ({ batchId }). Relative `.ts` imports only.
TEST FIRST: quoted comma field parses; missing header → error; phone `+91 98765-43210` normalises; bad dob → field error; is_teaching `Yes` → true; 5001 rows → validation_failed.
ACCEPT: `pnpm test tests/unit/imports-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: M04-T5 `data.import.stage` action
READ: BRIEF-COMMON.md; Task 4 schemas; `src/modules/academics/setup.actions.ts` (style); current-year lookup in `src/modules/core/actions.ts`
FILES: `src/modules/imports/actions.ts` (new, `"use server"`); `tests/db/imports-stage-action.test.ts` (new); + import line in `all-actions.ts` + fixture in `tests/security/escalation.test.ts`
EXPORTS: `stageImport` = `defineAction({ name: "data.import.stage", permission: "data.import", schema: StageImportSchema })`: parse; validate each row; for students resolve `grade` (grades.code) + `section` (class_sections.name) in the current academic year with ONE query per batch → `class_section_id`, `academic_year_id` (unknown → row error `section: not found`); duplicate admission_no/employee_no inside the file → row error; for staff resolve `department` by name (unknown → row error). Insert the batch, then rows in chunks of 500 (`status` valid|invalid, `errors` as `{field: [msg]}`), update counts. Audit counts only. Returns `{ batchId, rowCount, validCount, errorCount, errors: [{ rowNo, errors }] (first 50) }` with `rowNo` = CSV line number (header = 1).
TEST FIRST: 10-row CSV with 2 bad rows → 8 valid, 2 errors with row numbers 4 and 9; unknown section → row error; teacher → forbidden; 1 MB+ csv → validation_failed.
ACCEPT: `pnpm test:db tests/db/imports-stage-action.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 6: M04-T6 `data.import.commit` action + `imports.getBatch` query
READ: BRIEF-COMMON.md; Task 5 file; `src/modules/people/query-defs.ts` (query-def style)
FILES: `src/modules/imports/actions.ts` (edit); `src/modules/imports/queries.ts` (new) + `src/modules/imports/query-defs.ts` (new); `tests/db/imports-commit-action.test.ts` (new); + line in `all-queries.ts` + fixture in `escalation.test.ts`
EXPORTS: `commitImport` = `data.import.commit` {batchId} → `rpc("commit_import_batch")` → `{ committed, skipped, invalid }`; `getImportBatch(ctx, batchId)` → batch counts/status + rows that are invalid (row_no, errors) — never `data`; query `imports.getBatch` (`data.import`).
TEST FIRST: stage then commit → counts; commit twice → identical counts, student count unchanged; `imports.getBatch` returns invalid rows without `data`; accountant → forbidden.
ACCEPT: `pnpm test:db tests/db/imports-commit-action.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 7: M04-T7 `?format=csv` on GET /api/v1/query/<name>
READ: BRIEF-COMMON.md; `src/app/api/v1/query/[name]/route.ts`; `src/lib/http/dispatch.ts`
FILES: `src/app/api/v1/query/[name]/route.ts` (edit); `src/lib/http/csv.ts` (new: `toCsvResponse(result)`); `tests/unit/api-query-csv.test.ts` (new)
EXPORTS: when `format=csv` and the result is `ok` with an array of flat objects (or `{ rows: [...] }`), respond `text/csv; charset=utf-8`, `content-disposition: attachment; filename="<name>.csv"`, `cache-control: no-store`, body via `Papa.unparse`; nested values JSON-stringified; cells starting with `= + - @` prefixed with `'` (CSV injection). Non-list result → 422 `validation_failed` "not exportable as CSV". Errors keep the JSON envelope.
TEST FIRST (mock dispatch result): list → CSV with header; `=SUM(A1)` cell escaped; object result → 422; error envelope unchanged.
ACCEPT: `pnpm test tests/unit/api-query-csv.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 8: M04-T8 Acceptance + templates
READ: BRIEF-COMMON.md; Tasks 5–6 tests
FILES: `public/templates/students.csv`, `public/templates/staff.csv` (new: header row = `STUDENT_COLUMNS`/`STAFF_COLUMNS` + one example row); `tests/db/imports-acceptance.test.ts` (new)
TEST: generate a 200-student CSV (5 deliberately bad rows at known lines: bad phone, bad dob, unknown section, missing first_name, duplicate admission_no in file) over HTTP (`/api/v1/actions/data.import.stage` then `.commit`, bearer admin) → 195 committed, 5 reported with exact row numbers; commit again → same counts, students unchanged; `GET /api/v1/query/people.listStudents?format=csv` → CSV contains a committed admission_no. Template headers equal the schema column constants (read the files in the test).
ACCEPT: `pnpm test:db tests/db/imports-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T8: `11-operations.md` onboarding runbook (day 1 templates + import, day 2 structure + timetable + fees, day 3 invites + training + go-live); DBT-44 (fee/marks CSV deferred); `07 §4` note (commit is invoker, no definer); security review on the diff; full gate incl. `pnpm db:reset`-free reseed check (`seed-determinism`); commit/push; `DONE M04 <sha>`.
