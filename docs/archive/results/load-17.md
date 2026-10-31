# Load results — Day 17 (T-043)

Environment: **laptop** (same machine, same build, as Day 15 —
`scripts/load/README.md`'s "indicative, not production" caveat applies
equally). Date: 2026-10-30 (same sitting as Day 15 — not a real calendar
day apart; see note below). Git sha: `d1ef814` + the same uncommitted
T-043 changes as `load-15.md`.

Hosted run: **not attempted**, same reason as Day 15 — T-044 not approved.

**Note on timing:** the packet schedules this as a separate Day-17 pass
(09 §2) to catch drift after Days 16's integration work. This packet ran
both passes back to back in one sitting instead of on two calendar days,
so the "delta" below is a same-build, same-seed rerun — it shows run-to-run
noise, not drift from intervening changes. Treat it as a second data
point, not a trend.

| Scenario | Params | p50 | p95 | Errors | Delta vs Day 15 |
|---|---|---|---|---|---|
| L1 attendance burst | 72 sections, 42 records/section, concurrency 10 | 33 ms | 61 ms | 0 | p95 −24 ms (85→61); wall 264 ms vs 288 ms. Same deviation as Day 15 (1 admin session, not 72 teachers). |
| L2 guardian — baseline | 1.7 rps, 10 min | 24 ms | 48 ms | 0 | p95 −1 ms (49→48) — flat. |
| L2 guardian — peak | 10 rps, 5 min | 72 ms | 144 ms | 0 | p95 −6 ms (150→144) — flat, the Day 15 baseline→peak jump reproduces (3x). |
| L3 bulk invoice generation | 3,024 students, 1 fresh term | wall: 13,877 ms | rows/s: 217.91 | 0 | wall +1,820 ms, rows/s −32.9 vs Day 15 (12,057 ms / 250.81) — within laptop run-to-run noise (other processes on the same machine), not a regression signal. 3,024/3,024 invoices both times (fix holds). |
| L4 public site | 50 rps, 2 min | 152 ms | 301 ms | 0 | p50 +4 ms, p95 +1 ms vs Day 15 — flat. |
| L5 AI concurrency | — | — | — | — | Referenced to `pnpm ai:bench`, not re-run here. |

## Carried over from Day 15

The `finance.generate_term_invoices` pagination fix (PostgREST 1,000-row
default page) held on this rerun — both Day 15 and Day 17 passes generated
exactly 3,024/3,024 invoices in 1 attempt, 0 lock waits sampled. No new
hot spot found on this pass.
