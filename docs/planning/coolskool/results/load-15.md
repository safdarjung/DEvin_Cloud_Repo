# Load results — Day 15 (T-043)

Environment: **laptop** (client and server both on this machine — `pnpm
build && pnpm start` on port 3000, local Supabase). Numbers are
indicative, not production numbers (09 §9 / `scripts/load/README.md`).
Date: 2026-10-30. Git sha: `d1ef814` + uncommitted T-043 changes (load
scripts, a `finance.generate_term_invoices` pagination fix, and its
regression test — not yet committed by this packet; see T-043 report).

Hosted run: **not attempted.** T-044 (hosted preview environment) is not
approved as of this packet — out of scope per the packet's own framing.
Deferred to whenever T-044 lands (09 §9: Day 17 if early, else Day 18).

| Scenario | Params | p50 | p95 | Errors | Observations |
|---|---|---|---|---|---|
| L1 attendance burst | 72 sections, 42 records/section, concurrency 10 | 33 ms | 85 ms | 0 | **Deviation:** ran as 1 admin session, not 72 teacher sessions — seed only names 3 class-teacher logins; `isClassTeacherOrAdmin` lets admin submit for any section, so write volume is real, identity count isn't. Wall time 288 ms for all 72. |
| L2 guardian load — baseline | 1.7 rps, 10 min | 24 ms | 49 ms | 0 | **Deviation:** 2 real guardian sessions round-robinned, not 200 — seed only names 2 guardian logins. 0 non-2xx, 0 timeouts. |
| L2 guardian load — peak | 10 rps, 5 min | 73 ms | 150 ms | 0 | Same 2-session deviation. p95 triples vs baseline at ~6x the rate — worth watching at Day 17, not yet a hot spot on laptop-scale data. |
| L3 bulk invoice generation | 3,024 students, 1 fresh term | wall: 12,057 ms | rows/s: 250.81 | 0 | **Found + fixed**: `finance.generate_term_invoices` only processed the first 1,000 of 3,024 active enrolments (PostgREST's default page size, no `.range()`) and still reported the job `succeeded` — silent data loss, not a timeout. Fixed in `src/modules/jobs/handlers/finance.generate_term_invoices.ts` (explicit pagination) with a regression test (`tests/db/invoice-generation.test.ts`, >1,000 enrolments). After the fix: 3,024/3,024 invoices, 1 attempt, 0 lock waits sampled. `EXPLAIN ANALYZE` of `app.generate_invoice` (1 call, rolled back): ~7.2 ms execution time, 1930 buffer hits. |
| L4 public site | 50 rps, 2 min | 148 ms | 300 ms | 0 | 6,000 requests, all 200, 0 non-2xx, 0 timeouts. |
| L5 AI concurrency | — | — | — | — | Referenced to `pnpm ai:bench` (T-040), not re-run here. |

## Follow-ups (owning lane, measurement attached)

1. **Fixed here** (within this packet's "query fix" authorization, since
   it's the direct root cause of an L3 target not being met): the
   PostgREST 1,000-row default page truncated
   `finance.generate_term_invoices`'s enrolment query. Same bug class is
   worth a one-time audit of every other `admin.from(...)` query without
   `.range()` across job handlers and actions that can exceed 1,000 rows
   at scale (jobs/finance lane) — this packet only touched the one query
   this load test happened to hit.
2. `app.complete_job`'s backoff is `2^attempts` minutes (0003). L3
   completed in 1 attempt here, so this wasn't exercised, but if a future
   run needs >1 attempt, a multi-minute wait between attempts is a real
   operational characteristic, not a bug — noted for the jobs lane in case
   it ever shows up at hosted scale.
3. L2 peak p95 (150 ms) vs baseline p95 (49 ms) is a 3x jump at ~6x the
   request rate on a laptop running both client and server — re-check on
   Day 17 and, if possible, a non-laptop split before drawing a
   conclusion.
