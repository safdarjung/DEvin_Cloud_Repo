# M04-T4 report — CSV parse + import row schemas

Packet: M04-T4 CSV parse + row schemas (+ dep)

Files changed:
- `package.json`, `pnpm-lock.yaml` — added `papaparse@5.7.0` (dep), `@types/papaparse@5.5.2` (devDep)
- `src/modules/imports/schemas.ts` (new)
- `tests/unit/imports-schemas.test.ts` (new)

Behavior implemented:
- `parseCsv(text)`: Papa.parse with `header:true`, `skipEmptyLines:true`, trims headers/cells. Throws `AppError("validation_failed")` on empty input, any Papa parse error (e.g. field-count mismatch), or >5000 data rows.
- `STUDENT_COLUMNS` / `STAFF_COLUMNS`: template header order (readonly tuples).
- `StudentImportRowSchema` / `StaffImportRowSchema`: `.strict()` Zod objects validating raw CSV cell strings — all CSV-shape only (grade/section/department stay as free text; stage action T5 resolves ids). Guardian/staff phone normalizes spaces, dashes, and a leading `+91` before the `^[6-9][0-9]{9}$` check. `is_teaching` maps case-insensitive yes/no to boolean. Optional fields (last_name, department, phone, email, roll_no) treat blank CSV cells as absent.
- `StageImportSchema` ({entityType, fileName ≤200, csv ≤1 MB}), `CommitImportSchema` ({batchId: uuid}).
- Imports inside `schemas.ts` are relative `.ts` (mirrors `core/schemas.ts`); test file imports via `@/modules/imports/schemas` alias, matching existing test convention.

Tests run: `pnpm test tests/unit/imports-schemas.test.ts` → 20 passed (1 test file). TDD: confirmed RED (module not found) before writing `schemas.ts`, then GREEN.
`pnpm lint` → clean. `pnpm typecheck` → clean.

Tests not run and why: no DB/security/E2E suites — this task is pure unit-level parse/validate, no DB or action code touched.

Limitations / honesty label: n/a — no UI, no simulated/limited surface.

Security / integration risks: none new. `parseCsv`/row schemas only validate shape; no DB writes, no RLS surface. Stage action (T5) must still re-check duplicate admission_no/employee_no within a file and resolve grade/section/department to ids — not this task's job per brief.

Follow-ups: none beyond T5 (stage action) as already scheduled in M04-tasks.md.

New dependencies (justification): `papaparse` — plan-approved, quoting-correct CSV parse, no Node std-lib CSV parser; `@types/papaparse` (dev) for its types.

Assumptions made:
- "missing header → error" interpreted as empty/whitespace-only CSV input (no way to detect a semantically-missing header column generically in `parseCsv`, which doesn't know about `STUDENT_COLUMNS`/`STAFF_COLUMNS`); malformed/mismatched field-count rows are covered separately via Papa's own parse errors.
- `grade`/`section` in `StudentImportRowSchema` are length-bounded free text (1–20 chars), consistent with the brief's `admission_no 1–40`-style notation elsewhere, not a numeric 1–20 range.
- 1 MB `csv` cap implemented as 1,048,576 chars (`z.string().max(...)`), not a byte-accurate check — JS string length vs UTF-8 byte count can diverge for multi-byte input; acceptable given CSV import data is overwhelmingly ASCII (names in Latin script per existing demo fixtures).
