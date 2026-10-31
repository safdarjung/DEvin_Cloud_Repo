# T-016 — Seed attendance (60 days)

| Field | Value |
|---|---|
| Lane / Day | A / Day 7 |
| Size | 0.5 agent-days |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-ATT-01, F-ATT-05, F-IDN-06 |
| Depends on | T-015 (merged), T-013 (merged) |
| Migration | — |

## Business outcome
The demo tenant shows a realistic attendance history (≈181k records over 60 school days) so summaries, thresholds and the principal dashboard have data, and `pnpm db:reset` still completes in acceptable time.

## Current repo state (verify before starting)
- Seed framework and sections exist: `ls scripts/seed/index.ts scripts/seed/sections/`.
- `SeedContext` exposes sections, enrolments, staff ids: `grep -n "export interface SeedContext" -A 20 scripts/seed/context.ts`.
- Attendance tables exist: `grep -n "attendance_sessions" src/lib/db/types.ts | head -1`.

## Spec sections to read (only these)
`05-data-architecture.md §8` · `05 §2.4` · `06-workflows-and-contracts.md §W1` · `../09-twenty-day-plan.md §5` (seed too slow row) · `12-decision-log.md D19`.

## Files to inspect first
`scripts/seed/index.ts` (section order, PRNG, `uuidV5` helper) · `scripts/seed/sections/academics.ts` (how enrolments are produced and exposed) · `scripts/seed/lib/bulk.ts` (batched insert helper, if present).

## Expected changes
- `scripts/seed/sections/attendance.ts` — for each of the 72 sections and 60 school days (Mon–Fri plus alternate Saturdays, Jul–Oct 2026, skipping seeded holidays): one `attendance_sessions` row (`status = 'submitted'`, `marked_by` = class teacher), one `attendance_records` row per active enrolment with status drawn from the PRNG: 92% `P`, 6% `A`, 1% `L`, 1% `OL`; a few deterministic `attendance_corrections` (one per 2,000 records) with reasons.
- Bulk path: either `scripts/seed/lib/bulk.ts` COPY-style batched inserts of 5,000 rows, or a SQL function `app.seed_attendance(jsonb)` added by a new migration only if the lead reserves a number (prefer batched inserts; no migration by default).
- `scripts/seed/index.ts` — register the section after `academics` (one-line change, lead merges).
- `tests/db/seed-attendance.test.ts` — counts and idempotency.

## Must not modify
`supabase/migrations/**` (unless a number is reserved) · `src/**` · other seed sections.

## Permissions / nav / migration numbers needed from the lead
Only if the SQL bulk function is needed: reserve `20261028000012`. Default: none.

## Security and data-integrity requirements
- Uses the service-role client only through `scripts/seed` entrypoint (`SERVICE_ROLE_CALLER=seed`).
- Ids are UUID v5 from `(section, date)` and `(session, student)`; rerun must not create duplicates (`on conflict do nothing`).
- Respects the status validation trigger (only configured codes).

## Acceptance criteria
1. After `pnpm db:reset`: `attendance_sessions` = 72 × 60 = 4,320; `attendance_records` ≈ 181,440 (exact count asserted from enrolment count × 60).
2. Overall absence rate between 5.5% and 6.5%; every section has at least one absence on the latest day (so J-06 has data).
3. Running the section twice yields identical counts and identical ids.
4. `pnpm db:reset` wall time recorded in the completion report; if > 3 minutes, reduce to 40 days and record it as a debt row candidate.
5. `StudentAttendanceSummary` for `guardian.one`'s children shows a non-zero percentage.

## Tests (write failing tests first) and exact commands
- `tests/db/seed-attendance.test.ts` (counts, rate window, idempotency).
- `pnpm test:db -- tests/db/seed-attendance.test.ts` · `time pnpm db:reset`

## Deliverables
Seed section, index registration, test, timing evidence in the completion report.

## Assumptions and risks
- School days: Monday–Friday plus 2nd and 4th Saturdays, from 2026-07-01, skipping 15 Aug, 2 Oct, Dussehra (20–22 Oct) — recorded in the section header.
- Volume risk: batched inserts over PostgREST may be slow; fall back to `SUPABASE_DB_URL` with the `pg` driver inside `scripts/seed/lib/bulk.ts` if needed (one-line justification for the dependency).

## Completion report
Use the format in `CLAUDE.md`.
