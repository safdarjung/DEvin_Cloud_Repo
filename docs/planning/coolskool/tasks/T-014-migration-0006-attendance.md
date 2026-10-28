# T-014 — Migration 0006: attendance + RLS (T)

| Field | Value |
|---|---|
| Lane / Day | A / Day 5 |
| Size | 0.5 agent-days |
| Critical path | no |
| Review | security-reviewer + lead |
| Feature ids | F-ATT-01, F-ATT-02 |
| Depends on | T-011 (merged) |
| Migration | `supabase/migrations/20261028000006_attendance.sql` |

## Business outcome
The database can hold one attendance register per section per day, one row per student, with a correction log, and only the class teacher (or admin roles) can write it.

## Current repo state (verify before starting)
- Migrations 0001–0005 merged: `ls supabase/migrations/ | grep -c 2026102800` → 5.
- Helpers exist: `grep -n "teaches_section\|staff_roles\|set_updated_at\|block_mutation" supabase/migrations/20261028000001_foundation.sql`.
- `class_sections`, `enrolments`, `staff` exist: `grep -n "create table public.class_sections\|create table public.enrolments" supabase/migrations/20261028000005_academics.sql`.
- Test helpers exist: `ls tests/helpers/roles.ts tests/security/rls-expectations.ts`.

## Spec sections to read (only these)
`05-data-architecture.md §2.4`, `§4.1` (attendance block), `§5`, `§6` · `07-security-and-ai-governance.md §2` (attendance rows) · `08-testing-and-acceptance.md §3 C-15, C-16`.

## Files to inspect first
`supabase/migrations/20261028000001_foundation.sql` (helper signatures, trigger functions) · `supabase/migrations/20261028000005_academics.sql` (policy style to copy) · `tests/security/rls-expectations.ts` (entry shape).

## Expected changes
- `supabase/migrations/20261028000006_attendance.sql` — tables `attendance_sessions`, `attendance_records`, `attendance_corrections` with constraints/indexes from `05 §2.4`; `app.set_updated_at` triggers; `app.block_mutation` on `attendance_corrections`; trigger `app.validate_attendance_status()` that rejects any `status` not present in `institutions.settings->'attendance'->'statuses'[*]->>'code'`; RLS: SELECT class S+G (staff roles; guardians via `app.guardian_student_ids`; student via `app.own_student_id`), INSERT/UPDATE on sessions/records class T (`app.teaches_section(institution_id, class_section_id)` or `app.has_role(institution_id, '{owner,principal,admin}')`), INSERT on corrections for the same set; no DELETE policies.
- `src/lib/db/types.ts` — regenerate with `pnpm db:types`.
- `tests/security/rls-expectations.ts` — add the three tables with their policy classes.
- `tests/db/attendance-schema.test.ts` — C-15 (correction row append-only), C-16 (teacher of A cannot insert for B), status validation, uniqueness.

## Must not modify
Migrations 0001–0005 · `src/lib/auth/permissions.ts` · any `src/modules/**` file (T-015 owns the module) · `scripts/seed/**`.

## Permissions / nav / migration numbers needed from the lead
None (0006 is reserved for this packet; permissions `attendance.*` already exist).

## Security and data-integrity requirements
- Every table has `institution_id`; every policy filters on it; `institution_id` and `class_section_id`, `student_id`, `session_id` indexed.
- `unique(class_section_id, date)` and `unique(session_id, student_id)` enforced in SQL, not in app code.
- Corrections are append-only; records keep only the current status.
- Status codes validated by trigger against settings so a renamed code cannot be written.

## Acceptance criteria
1. `pnpm db:reset` applies 0006 cleanly on a fresh database and `pnpm db:types` shows the three tables.
2. Teacher who is class teacher of VI-A can insert a session and records for VI-A; the same teacher gets a policy error for VIII-B (C-16).
3. Guardian selects only records of linked students; cross-institution SELECT returns 0 rows (generated suite C-01 picks up the new expectation entries).
4. Inserting `status = 'X'` fails with the validation trigger message; `'P'`, `'A'`, `'L'`, `'HD'`, `'OL'` succeed.
5. UPDATE or DELETE on `attendance_corrections` raises.

## Tests (write failing tests first) and exact commands
- `tests/db/attendance-schema.test.ts`: C-15, C-16, status trigger, uniqueness.
- `pnpm test:db -- tests/db/attendance-schema.test.ts`
- `pnpm test:security -- tests/security/rls.generated.test.ts` (must now include the three tables).

## Deliverables
Migration file, regenerated types, expectations entries, test file, completion report.

## Assumptions and risks
- `app.teaches_section` returns true for class teacher or any subject assignment in the section (`05 §5`); attendance marking by subject teachers is therefore allowed at the RLS layer and narrowed to class teacher in T-015's action layer.
- Date is a plain `date` in the institution timezone; the app converts.

## Completion report
Use the format in `CLAUDE.md`.
