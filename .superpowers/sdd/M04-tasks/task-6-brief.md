### Task 6: M04-T6 `data.import.commit` action + `imports.getBatch` query
READ: BRIEF-COMMON.md; Task 5 file; `src/modules/people/query-defs.ts` (query-def style)
FILES: `src/modules/imports/actions.ts` (edit); `src/modules/imports/queries.ts` (new) + `src/modules/imports/query-defs.ts` (new); `tests/db/imports-commit-action.test.ts` (new); + line in `all-queries.ts` + fixture in `escalation.test.ts`
EXPORTS: `commitImport` = `data.import.commit` {batchId} → `rpc("commit_import_batch")` → `{ committed, skipped, invalid }`; `getImportBatch(ctx, batchId)` → batch counts/status + rows that are invalid (row_no, errors) — never `data`; query `imports.getBatch` (`data.import`).
TEST FIRST: stage then commit → counts; commit twice → identical counts, student count unchanged; `imports.getBatch` returns invalid rows without `data`; accountant → forbidden.
ACCEPT: `pnpm test:db tests/db/imports-commit-action.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

