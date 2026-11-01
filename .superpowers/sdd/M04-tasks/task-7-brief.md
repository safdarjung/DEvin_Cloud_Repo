### Task 7: M04-T7 `?format=csv` on GET /api/v1/query/<name>
READ: BRIEF-COMMON.md; `src/app/api/v1/query/[name]/route.ts`; `src/lib/http/dispatch.ts`
FILES: `src/app/api/v1/query/[name]/route.ts` (edit); `src/lib/http/csv.ts` (new: `toCsvResponse(result)`); `tests/unit/api-query-csv.test.ts` (new)
EXPORTS: when `format=csv` and the result is `ok` with an array of flat objects (or `{ rows: [...] }`), respond `text/csv; charset=utf-8`, `content-disposition: attachment; filename="<name>.csv"`, `cache-control: no-store`, body via `Papa.unparse`; nested values JSON-stringified; cells starting with `= + - @` prefixed with `'` (CSV injection). Non-list result → 422 `validation_failed` "not exportable as CSV". Errors keep the JSON envelope.
TEST FIRST (mock dispatch result): list → CSV with header; `=SUM(A1)` cell escaped; object result → 422; error envelope unchanged.
ACCEPT: `pnpm test tests/unit/api-query-csv.test.ts`; `pnpm lint`; `pnpm typecheck`

