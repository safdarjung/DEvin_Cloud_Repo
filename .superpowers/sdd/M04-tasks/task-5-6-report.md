# M04-T5/T6 report

Packet: M04-T5 `data.import.stage` + M04-T6 `data.import.commit` / `imports.getBatch`

## Files changed

- `src/modules/imports/actions.ts` (new) — `stageImport`, `commitImport`
- `src/modules/imports/queries.ts` (new) — `getImportBatch`
- `src/modules/imports/query-defs.ts` (new) — `imports.getBatch`
- `src/app/api/v1/actions/all-actions.ts` (edit) — import line
- `src/app/api/v1/query/all-queries.ts` (edit) — import line
- `tests/security/escalation.test.ts` (edit) — fixtures for `data.import.stage`, `data.import.commit`
- `tests/db/imports-stage-action.test.ts` (new)
- `tests/db/imports-commit-action.test.ts` (new)

## Behavior implemented

- `stageImport`: header-column check first (missing required column → `validation_failed`, `fieldErrors.csv`, no batch row created). Validates each row with `StudentImportRowSchema`/`StaffImportRowSchema`. Students: resolves `grade` code + `section` name → `class_section_id`/`academic_year_id` with one join query against current-year `class_sections` (mirrors `exams/queries.ts`'s `academic_years!inner(is_current)` pattern); staff: resolves `department` name → id with one query. Flags duplicate `admission_no`/`employee_no` within the file. Inserts batch then rows in chunks of 500. Audits counts only. Returns `{ batchId, rowCount, validCount, errorCount, errors }` (first 50, `rowNo` = CSV line, header = 1).
- `commitImport`: thin RPC wrapper over `commit_import_batch` (0066, security invoker) — no second audit call, matching `exams/actions.ts`'s `closeMarksEntry`/`enterMarks` shape (the SQL function already audits counts-only internally).
- `getImportBatch`: batch counts/status + invalid rows (`row_no`, `errors` only — `data` never selected, so no PII can leak via this path).

## Tests run

- `pnpm test:db tests/db/imports-stage-action.test.ts` → 4 passed (10-row CSV w/ 2 bad rows at lines 4 & 9; teacher forbidden; >1MB CSV → validation_failed; missing-column header → validation_failed, no batch row)
- `pnpm test:db tests/db/imports-commit-action.test.ts` → 2 passed (stage→commit→recommit identical counts, no duplicate students; `getImportBatch` invalid rows have no `data` key; accountant forbidden)
- `pnpm test tests/unit/action-names-unique.test.ts` → 4 passed
- `pnpm test:security tests/security/escalation.test.ts` → 572 passed
- `pnpm lint` → clean
- `pnpm typecheck` → clean

## Tests not run and why

None skipped — all packet-specified ACCEPT commands run above.

## Limitations / honesty label

Not applicable (no simulated/limited UI surface in this packet).

## Security / integration risks

None new. RLS + the existing `data.import` permission (T1) gate every table touched; `commit_import_batch`'s own role re-check (0066) covers cross-institution batch IDs. No row `data`/PII placed in audit rows, returned errors, or logs — confirmed by code read and by the `getImportBatch` test asserting only `rowNo`/`errors` keys.

## Follow-ups

None identified beyond the already-planned T7 (`?format=csv`) / T8 (acceptance + templates).

## New dependencies (justification)

None.

## Assumptions made

- Duplicate-in-file error message: `"duplicate in file"` on the `admission_no`/`employee_no` field (brief didn't specify exact text).
- Unknown grade/section/department error message: `"not found"` on the `section`/`department` field (matches brief's own example text for `section`).
- `commitImport` does not call `audit()` from the TS layer — the SQL function already writes a counts-only audit row (`app.audit_import_commit`); a second call would duplicate it. Followed the precedent in `exams/actions.ts` (`closeMarksEntry`, `enterMarks`, etc.), which also skip a TS-side `audit()` when the underlying RPC audits internally.
