Packet: M27-T1 Plant zero-candidate insight domains
Files changed: scripts/seed/sections/admissions.ts, tests/db/seed-admissions.test.ts
Behavior implemented: enquiryRows now set `updated_at = created_at`. `insight_src_admissions` proxies
stage dwell off `updated_at`; it previously defaulted to seed-run time (after AS_OF), so every enquiry
read as 0 days stale and `admissions.stage_dwell` never fired. Dry-run count: admissions 0 -> 1.
Per-domain results (M19-T21 dry run, as_of=2026-10-28): planted:
  - admissions.stage_dwell: root cause = `enquiries.updated_at` defaulted to seed time, not the
    fixed `created_at`; fix = set `updated_at: createdOn` on insert (3 lines); new count = 1 (was 0).
Debt (no file qualifies — structural, not a seed bug):
  - academics.marks_decline: only HY-2026 is published; PT2-X is a live demo step (one exam period
    of history) — the detector needs a decline across periods. M20 gap insights cover academics.
  - academics.missing_work / academics.awaiting_review: 05 §8.2 asserts zero homework assignments
    in the seed, so the source has no rows by contract.
  - finance.concession_spike: concessions are stamped at seed time, same class of bug as admissions,
    but no owning action timestamps a "concession granted" event before AS_OF to backdate; `overdue_growth`
    already covers the finance domain for the demo. Left per ruling.
Tests run: `pnpm demo:reset` (pre-fix, RED) -> seed-admissions.test.ts new case failed as expected;
applied fix -> `DEMO_RESET_ALLOWED=true pnpm demo:reset` -> `pnpm test:db tests/db/seed-admissions.test.ts
tests/db/insights-acceptance.test.ts tests/db/seed-determinism.test.ts` -> 3 files, 12 tests, all passed.
`pnpm lint` -> 0 errors (11 pre-existing warnings, none in touched files). `pnpm typecheck` -> clean.
Tests not run and why: none skipped; full test:db/test:security suite left to gate checkpoints per BRIEF-COMMON.
Limitations / honesty label: none (no UI, no label change).
Security / integration risks: none — additive column on insert, no schema/RLS change, idempotent rerun guard unchanged.
Follow-ups: 3 debt rows above stand as-is (already DBT-110's scope); no new decision-log row needed,
DBT-110 already covers "finance, academics = 0"; T9 (V2 gate) should cite this report for admissions.
New dependencies (justification): none
Assumptions made: planter's estimate in M27-tasks.md Task 1 rulings (admissions plantable, others
structural) verified directly against detector SQL/source and seed code before accepting it as-is.
