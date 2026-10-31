# Load scripts (T-043)

Measured numbers for the four scenarios in `08-testing-and-acceptance.md
§6` and `docs/archive/09-twenty-day-plan.md` (Days 15, 17). Nothing here asserts a
threshold in code — every script exits 0 and prints/writes a table. L5 (AI
concurrency) is not reimplemented here; see `pnpm ai:bench`.

## Setup

```bash
pnpm db:start            # local Supabase
pnpm db:reset            # migrations + seed (demo tenant)
pnpm build && pnpm start # production build, port 3000
```

Required env (`.env.local`, already set for `pnpm dev`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`.
`SEED_DEMO_PASSWORD` only if you changed it from the seed default.

**`LOAD_TARGET_URL` is required for every script** and is checked before
anything runs:

- Local: `LOAD_TARGET_URL=http://localhost:3000`
- Hosted demo: only with `LOAD_HOSTED_CONFIRMED=true` set explicitly — **not
  used for T-043**. T-044 (hosted preview) was not approved as of this
  packet; a hosted run is out of scope here and deferred to whenever T-044
  lands (Day 17 per the plan, else Day 18 per `09 §9`).

## Run

```bash
LOAD_TARGET_URL=http://localhost:3000 pnpm load:l1
LOAD_TARGET_URL=http://localhost:3000 pnpm load:l2
LOAD_TARGET_URL=http://localhost:3000 pnpm load:l3
LOAD_TARGET_URL=http://localhost:3000 pnpm load:l4
```

Dry run with tiny parameters (fast sanity check before a full run):

```bash
LOAD_TARGET_URL=http://localhost:3000 pnpm load:l4 -- --duration 5 --rate 2
LOAD_TARGET_URL=http://localhost:3000 pnpm load:l2 -- --d1 5 --r1 2 --d2 5 --r2 2
```

L1 and L3 **write real rows** to the demo tenant (attendance sessions/
records, a load-test term + invoices). Run **only** against the demo
tenant, then:

```bash
DEMO_RESET_ALLOWED=true pnpm demo:reset
```

before re-running L1/L3, or before anyone else uses the seeded demo data.
L2 and L4 are read-only.

Each run writes `scripts/load/out/<scenario>-<timestamp>.json` and `.md`
(git-ignored). Copy the numbers you want to keep into
`docs/archive/results/load-<day>.md` using
`load-template.md`'s table.

## What NOT to conclude

- **Laptop numbers are indicative, not production numbers.** The laptop
  runs the client (this script) and the server (`pnpm start`) at once —
  CPU contention between them inflates latency versus a real client/server
  split. State the environment in every result row.
- **L1 uses 1 admin session for 72 submits, not 72 teacher sessions.** The
  seed only creates 3 named class-teacher logins (`teacher.vi-a/.viii-b/
  .x-a`); `isClassTeacherOrAdmin` (`src/modules/attendance/actions.ts`)
  lets owner/principal/admin submit for any section, so the write volume
  (72 sections × ~42 records) is real, the session-identity count is not.
- **L2 round-robins 2 guardian sessions, not 200.** Same seed gap
  (`guardian.one`/`guardian.two` are the only guardian logins; ~2,400
  other `guardians` rows have no `auth.users` row). Request volume (rps)
  is unaffected.
- **L3's wall time skips the real inter-attempt backoff** (`2^attempts`
  minutes, `app.complete_job`, 0003) if the job needs more than one
  attempt — the harness resets `run_after` instead of sleeping it out, to
  keep the measurement loop a few minutes instead of tens of minutes. The
  result file says how many attempts were needed; more than 1 is itself a
  finding worth a follow-up for the jobs lane, not something fixed here.
- **L1 can be rerun on the same date without `demo:reset` in between** —
  unlike the real `markAttendance` action, the script's session upsert
  doesn't check for an already-`submitted` session before overwriting it
  back to `open`. That's fine for repeated throughput runs but means L1
  does not exercise that one state guard; it measures the write path's
  shape and volume, not that specific business rule.
- A single run is one data point, not a trend. Re-run before concluding
  anything moved between Day 15 and Day 17.
