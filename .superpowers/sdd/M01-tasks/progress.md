# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M01-tasks.md
Spec: docs/planning/fabric/07-master-plan-v1-v2.md §2 D40, §3 M1 (binding).
Ruling: work on main, no worktree — D38 owner decision (main-only) — cost if wrong: none, local commits until milestone push.
Ruling: implementers never run state-changing git (BRIEF-COMMON); controller commits per task after review — keeps BASE/HEAD diffs.
Ruling: sequential dispatch, Sonnet implementers, Sonnet task reviewers — owner token budget + plan §4.

## Pre-flight
| Pair/Task | Interface | Finding |
|---|---|---|
| T1→T4 | apiResponse, bearerToken | T4 needs 400/413 → Ruling: apiResponse(result, status?) added to T1 brief |
| T2→T4,T6 | withBearerToken, getClaims | ok |
| T3→T4,T6 | all-actions.ts side-effect import | T6 must import ./all-actions too (implicit) → stated in T6 dispatch |
| T3↔T5 | action-names-unique test, registerAction | meta optional → compatible |
| T5→T6 | getActionMeta | ok |
| T6 test | mock @/lib/supabase/server | server-client-mock lacks withBearerToken → Ruling: test factory spreads helper + adds getClaims/withBearerToken |
| T1..T6 self | tests vs code | consistent |

## Tasks
Ruling: mechanical tasks (T1,T3,T5) reviewed by controller (diff read + acceptance rerun); auth tasks (T2,T4,T6) get Sonnet task reviewer — owner token budget — cost if wrong: a missed quality nit, caught at final review.
Task 1: complete (commits b20cf39..2df2917, review clean)
Ruling: per-task review by controller for all tasks (diffs <60 lines); one Sonnet security-reviewer over full M1 diff before push — plan §4.5 requires it for auth — cost if wrong: late fix round.
Ruling: test filter is `pnpm test:db <file>` (no `--`; with `--` vitest runs whole project) — docs patched.
Task 2: complete (commits 2df2917..27ea1e5, review clean)
Task 3: complete (commits ..28527a6, review clean; mutation check: dropped import fails test)
Task 4: complete (commits ..fa2b3d6, review clean; x-institution header path untested — trivial, noted)
Task 5: complete (commits ..64feb64, review clean)
Task 6: complete (commits ..b2e6872, review clean)
Security review (Sonnet): 0 CRIT, 0 HIGH. MEDIUM no rate limit → Ruling: parked as DBT-42 (logged). LOW GET listing lacks Origin check → Ruling: no change — read-only GET, no CORS, response unreadable cross-origin.
M01 DONE b2e6872 pushed; gate green (unit 918, db 369, sec 1098)
