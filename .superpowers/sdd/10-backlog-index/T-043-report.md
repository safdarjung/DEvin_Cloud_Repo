Packet: T-043 Load scripts + Day 15/17 runs

Files changed:
- scripts/load/auth.ts (new — target guard, `@supabase/ssr` session-cookie login, latency percentile helper)
- scripts/load/l1-attendance-burst.ts (new)
- scripts/load/l2-portal-results.ts (new)
- scripts/load/l3-bulk-invoices.sql (new — `EXPLAIN ANALYZE` of `app.generate_invoice`)
- scripts/load/l3-bulk-invoices.ts (new)
- scripts/load/l4-public-site.ts (new)
- scripts/load/README.md (new)
- docs/planning/coolskool/results/load-template.md (new)
- docs/planning/coolskool/results/load-15.md (new)
- docs/planning/coolskool/results/load-17.md (new)
- package.json (`load:l1`..`load:l4` scripts; `autocannon` + `@types/autocannon` devDependencies — named by the packet, "autocannon programmatic API")
- src/modules/jobs/handlers/finance.generate_term_invoices.ts (fix — see "Finding" below; application code, outside this packet's normal "must not modify", authorized by the lead's own instruction for a load target that fails root-causing to a query fix)
- tests/db/invoice-generation.test.ts (new regression test for the above fix)

Behavior implemented:
Five load scripts (L1-L4 run; L5 referenced to `pnpm ai:bench`, not reimplemented) per `08-testing-and-acceptance.md §6`. `LOAD_TARGET_URL` is required and gated to local or an explicit `LOAD_HOSTED_CONFIRMED=true` opt-in; no threshold assertions, every script exits 0 and writes `scripts/load/out/<scenario>-<ts>.{json,md}` (git-ignored, matches existing `out/` pattern). L1/L3 write real rows and the README says to `demo:reset` after.

Finding + fix (L3): `finance.generate_term_invoices` queried `enrolments` via `admin.from(...)` with no `.range()`. PostgREST defaults to a 1,000-row page, so for the seeded tenant's 3,024 active enrolments the handler silently processed only the first 1,000 and still reported the job `succeeded` — no error, `outOfBudget` never set. This is silent data loss, not a timeout, and was also the root cause of `tests/db/seed-determinism.test.ts` initially failing mid-session (traced to my own leftover L3 test term from before the fix, not a seed bug — confirmed clean after a `demo:reset`). Fixed with explicit pagination (loop `.range()` until a short page); added a regression test creating 1,001 active enrolments via bulk SQL and asserting all 1,001 get invoices.

Tests run:
- `pnpm test` → 33 files, 378/378 pass.
- `pnpm lint` → clean. `pnpm typecheck` (`next typegen && tsc --noEmit`) → clean. `pnpm build` → clean (TypeScript project check also covers `scripts/**`, caught two `autocannon` type mismatches — `path` isn't a top-level `Options` field, and the percentile bucket is `p97_5`, not `p95` — both fixed in l2/l4).
- `pnpm test:db -- tests/db/invoice-generation.test.ts tests/db/seed-determinism.test.ts` (ran all 45 db files regardless — vitest's CLI filter didn't narrow it; ran to completion anyway) → 45/45 files, 311/311 tests pass, on a clean reseeded tenant.
- `pnpm test:security` not run — no RLS/migration/SQL policy changed, only a TS handler query and a DB test file.
- Dry runs exactly as specified: `LOAD_TARGET_URL=http://localhost:3000 pnpm load:l4 -- --duration 5 --rate 2` and an analogous `pnpm load:l2 -- --d1 5 --r1 2 --d2 5 --r2 2`.
- Full runs against local Supabase + `pnpm build && pnpm start`, twice (Day 15 pass, then a same-sitting Day 17 pass) — numbers in `docs/planning/coolskool/results/load-15.md` / `load-17.md`. `demo:reset` run after every L1/L3 pass.

Numbers (Day 15 pass; see `load-17.md` for the rerun):

| Scenario | Params | p50 | p95 | Errors |
|---|---|---|---|---|
| L1 attendance burst | 72 sections × 42 records, concurrency 10 | 33 ms | 85 ms | 0 |
| L2 baseline | 1.7 rps, 10 min | 24 ms | 49 ms | 0 |
| L2 peak | 10 rps, 5 min | 73 ms | 150 ms | 0 |
| L3 bulk invoices | 3,024 students | wall 12,057 ms | 250.8 rows/s | 0 |
| L4 public site | 50 rps, 2 min | 148 ms | 300 ms | 0 |

Tests not run and why: `pnpm test:e2e` — not requested by this packet, no UI changed. Hosted run — T-044 not approved, out of scope per the packet; recorded explicitly in both result files.

Limitations / honesty label: no user-facing UI changed, no honesty badge applies. Three deviations from the packet's literal parameters, all documented in `scripts/load/README.md` and both result files: (1) L1 uses 1 admin session for all 72 submits, not 72 teacher sessions — seed only names 3 class-teacher logins; (2) L2 round-robins 2 real guardian sessions, not 200 — seed only names 2; (3) L1's session upsert doesn't replicate `markAttendance`'s "already submitted" guard, so it can rerun same-day without a reset (measures write shape/volume, not that one state rule). L3's harness fast-forwards the job system's `2^attempts`-minute backoff instead of sleeping it out (not exercised this run — both passes finished in 1 attempt).

Security / integration risks: L1/L3 write real rows to the demo tenant only (gated by `requireLoadTarget`); never ran against anything but `localhost:3000` in this session. No secrets printed (env values redacted throughout this session's own tool output). The job-handler fix only adds pagination to an existing service-role read; no new RLS surface, no migration.

Follow-ups (12-decision-log.md §Debt candidates):
- One-time audit of other `admin.from(...)` queries without `.range()` across job handlers/actions that could exceed 1,000 rows at scale (jobs/finance lane) — this packet only fixed the one query this load test happened to hit.
- L2 peak p95 (150/144 ms) vs baseline p95 (49/48 ms) is a ~3x jump at ~6x the request rate, reproduced on both passes — worth a non-laptop (split client/server) measurement before concluding anything, per the lead's own "indicative, not production" framing.

New dependencies (justification): `autocannon` + `@types/autocannon` (devDependencies) — named explicitly by the packet ("autocannon programmatic API") for L2/L4.

Assumptions made:
- L1's fixed attendance date (today − 10 days) is deliberate, not arbitrary — far enough back to clear the 7-day correction-permission check, close enough to be realistic, and stable across reruns before a reset.
- L3's "fresh term" is a new `terms` row (sequence 99) under the current academic year, not a reused seeded term — a reused term with existing invoices would make `generate_invoice` a no-op for every student (idempotent), understating the real write cost.
- Treated this orchestration's explicit instruction ("if a load target fails, find root cause... fix minimal: a migration or a query fix") as authorizing the one query fix above, overriding the packet's own "must not modify application code" for that specific, narrowly-scoped case — not used as license for any other change.
