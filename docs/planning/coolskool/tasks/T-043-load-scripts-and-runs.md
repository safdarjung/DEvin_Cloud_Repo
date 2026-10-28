# T-043 — Load scripts + Day 15/17 runs

| Field | Value |
|---|---|
| Lane / Day | C / Day 14–15, 17 |
| Size | 1 agent-day (scripts) + 2 × 0.5 (runs) |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-PLT-05, F-PLT-07 (inputs) |
| Depends on | T-041 (merged) |
| Migration | — |

## Business outcome
Measured, reproducible numbers for the four load scenarios (teacher attendance burst, result-day guardian load, bulk invoice generation, public site) so nothing about performance is asserted without evidence.

## Current repo state (verify before starting)
- Seeded tenant and E2E fixtures: `ls e2e/fixtures.ts`.
- Jobs runner: `ls src/modules/jobs/runner.ts scripts/jobs-run.ts`.
- `pnpm dlx autocannon --help` works offline after first download.

## Spec sections to read (only these)
`08-testing-and-acceptance.md §6` · `09-twenty-day-plan.md §2` (Days 15, 17) · `11-operations.md §8` (sizing primitives) · `04 §3` (which path each scenario hits).

## Files to inspect first
`src/modules/attendance/actions.ts` (`markAttendance`/`submitAttendance` call shape) · `src/app/(tenant)/[institution]/portal/page.tsx` · `src/modules/jobs/handlers/finance.generate_term_invoices.ts`.

## Expected changes
- `scripts/load/README.md` — how to run, environment fields to fill, what not to conclude.
- `scripts/load/auth.ts` — obtains session cookies for N demo users (72 teachers for L1, 200 guardian sessions reused round-robin for L2) via the Supabase password grant against the target; never stores tokens on disk.
- `scripts/load/l1-attendance-burst.ts` — autocannon programmatic API: 72 submits (≈42 records each) at concurrency 10 over 15 min compressed to a 2-min window; reports p50/p95, errors.
- `scripts/load/l2-portal-results.ts` — 1.7 rps baseline for 10 min then 10 rps for 5 min on `/[institution]/portal/results`; reports p95 TTFB, error rate.
- `scripts/load/l3-bulk-invoices.sql` + `l3-bulk-invoices.ts` — times `finance.generate_term_invoices` for a fresh term over 3,024 students (`EXPLAIN ANALYZE` of `app.generate_invoice` once; lock waits from `pg_stat_activity` sample).
- `scripts/load/l4-public-site.ts` — 50 rps for 2 min on `/s/st-josephs-demo`.
- `docs/planning/coolskool/results/load-template.md` — table per scenario: environment (laptop | Vercel+hosted), date, git sha, params, p50, p95, errors, observations.
- `docs/planning/coolskool/results/load-15.md`, `load-17.md` — filled on those days.
- `package.json` — `load:l1`…`load:l4`.

## Must not modify
Application code (if a hot spot is found, file it as a follow-up for the owning lane with the measurement attached).

## Permissions / nav / migration numbers needed from the lead
None.

## Security and data-integrity requirements
- Scripts refuse to run unless `LOAD_TARGET_URL` is set explicitly and the target is local or the user-confirmed hosted demo URL.
- L1 and L3 write real rows: run only on the demo tenant and `pnpm demo:reset` afterwards (documented in README).
- No thresholds are asserted in code; scripts exit 0 and print tables.

## Acceptance criteria
1. Each script runs end to end locally and writes a JSON + markdown summary to `scripts/load/out/` (git-ignored).
2. `load-15.md` contains all four scenarios with environment and sha; `load-17.md` the same plus a delta column vs Day 15.
3. L5 (AI concurrency) is referenced to `pnpm ai:bench` output, not re-implemented.

## Tests (write failing tests first) and exact commands
- Dry run with tiny parameters: `LOAD_TARGET_URL=http://localhost:3000 pnpm load:l4 -- --duration 5 --rate 2`
- `pnpm load:l1 && pnpm load:l2 && pnpm load:l3 && pnpm load:l4` (Day 15, Day 17)

## Deliverables
Five scripts, README, template, two result files (Days 15/17), follow-up list for hot spots.

## Assumptions and risks
- Laptop runs client and server; numbers are indicative (stated in every result file).
- Hosted run on Day 17 only if T-044 preview environment exists early; otherwise Day 18 after deploy, noted.

## Completion report
Use the format in `CLAUDE.md`.
