Packet: M04-T7/T8 — `?format=csv`, import acceptance test, CSV templates

Files changed:
- `src/lib/http/csv.ts` (new) — `toCsvResponse(result, name)`
- `src/app/api/v1/query/[name]/route.ts` (edit) — GET branches to CSV on `?format=csv`
- `tests/unit/api-query-csv.test.ts` (new)
- `tests/db/imports-acceptance.test.ts` (new)
- `public/templates/students.csv`, `public/templates/staff.csv` (new)

Behavior implemented:
- `toCsvResponse`: error envelope passes through `apiResponse` unchanged. Ok result exports when its data is a bare array, OR an object with exactly one array-valued property (covers `{ rows: [...] }` and paginated page objects like `{ students, total, page, pageSize }`); otherwise 422 `validation_failed`. CSV via `Papa.unparse`; nested values JSON-stringified first; any resulting string cell starting with `= + - @` gets an apostrophe prefix (CSV-injection guard). Headers: `text/csv; charset=utf-8`, `content-disposition: attachment; filename="<name>.csv"`, `cache-control: no-store`.
- Route: GET reads `dispatchCall`'s `Response.json()` only when `format=csv` is present; no other route behavior touched. POST unchanged (brief only names GET).
- Acceptance test: 200-row student CSV, 5 bad rows at known lines (11 bad phone, 51 bad dob, 101 unknown section, 151 missing first_name, 181 duplicate admission_no) via real HTTP `data.import.stage` → `.commit` → recommit idempotent → `people.listStudents?format=csv` contains a committed admission_no.
- Templates: header row = `STUDENT_COLUMNS`/`STAFF_COLUMNS` + one example row; test reads both files and asserts header equality with the schema constants.

Assumption (flagged, not hidden): brief's T7 spec names two exportable shapes — bare array and `{ rows: [...] }` — but T8's required acceptance query, `people.listStudents`, actually returns `{ students, total, page, pageSize }` (the only paginated-page query in the codebase; everything else is a bare array). Literal `rows`-only support would 422 on that exact acceptance call. Generalized the rule to "exactly one array-valued property," which is a strict superset covering `rows` and this page shape without guessing at other keys. Covered by a dedicated unit test. No source files (`people/queries.ts` etc.) touched.

Tests run:
- `pnpm test tests/unit/api-query-csv.test.ts` → 7/7 pass
- `pnpm test:db tests/db/imports-acceptance.test.ts` → 2/2 pass
- `pnpm lint` → clean
- `pnpm typecheck` → clean

Tests not run and why: full `pnpm test`/`pnpm test:db` suites not run (brief scopes to these two files; single-DB-owner rule).

Limitations / honesty label: n/a (no UI, no simulated/limited surface).

Security / integration risks: CSV export reuses the query's own permission gate (no new `data.export` permission, per ruling) — no new authz surface. CSV-injection guard applied to every string/stringified cell.

Follow-ups: none identified; `11-operations.md` runbook + full gate are Opus's post-T8 steps per the task header, out of this packet's scope.

New dependencies (justification): none — `papaparse` already added in T4.

Assumptions made: see shape-generalization note above. Recommit-idempotency and duplicate-detection semantics taken as already correct per T2/T3/T5 (not re-verified beyond this acceptance pass).
