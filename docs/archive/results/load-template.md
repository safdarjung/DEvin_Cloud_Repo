# Load result template (T-043, `08 §6`)

One row per scenario per run. Copy this table into `load-<day>.md`.
Numbers only — never a pass/fail assertion in code (`scripts/load/`
exits 0 regardless).

| Scenario | Environment | Date | Git sha | Params | p50 | p95 | Errors | Observations |
|---|---|---|---|---|---|---|---|---|
| L1 attendance burst | laptop \| Vercel+hosted | | | sections=72, records/section=42, concurrency=10 | | | | |
| L2 result-day guardian — baseline | laptop \| Vercel+hosted | | | 1.7 rps, 10 min | | | | |
| L2 result-day guardian — peak | laptop \| Vercel+hosted | | | 10 rps, 5 min | | | | |
| L3 bulk invoice generation | laptop \| Vercel+hosted | | | 3,024 students, 1 term | wall ms: | rows/s: | | lock waits: |
| L4 public site | laptop \| Vercel+hosted | | | 50 rps, 2 min | | | | |
| L5 AI concurrency | — | | | see `pnpm ai:bench` output | | | | referenced, not re-run here |

"Environment" is never left blank: laptop runs both client and server at
once (indicative only, per `scripts/load/README.md`); a hosted run needs
`LOAD_HOSTED_CONFIRMED=true` and T-044 approved.
