Packet: M27-T2 Seed section `fabric` part 1 — insights, lifecycle, interventions
Files changed: scripts/seed/sections/fabric.ts (new), scripts/seed/index.ts (Edit, registers fabric last), tests/db/seed-fabric.test.ts (new)
Behavior: run(ctx) computes AS_OF, runs insightsDetect + runMasteryGapDetector, picks INS-REVIEWING/ACTIONED/DISMISSED via pure pickLifecycleTargets, runs decide_insight/record_insight_action as principal, activates first proposed VI-A plan (roll_no order). All idempotent (gated on current DB state).
Defect found, NOT fixed (outside FILES): detector.ts planAuthor() requires an active 'owner' membership; demo roster (05 §8.1) has none — confirmed 0 owner rows. Caught in run() (logged), so seed still completes; PLAN-VI-A-ACTIVE finds 0 plans, skips per its own ruling. Fix: widen planAuthor to owner/principal/admin (~2 lines, no migration); flip the skipped-test once done.
Defect found + FIXED (my code): `select (record_insight_action(...)).*` re-invoked the volatile fn once per expanded column (22 planned rows from 1 call, repro'd live). Fixed with a CTE materializing the call once; verified 1 row.
Tests run: `DEMO_RESET_ALLOWED=true pnpm demo:reset` completes, counts match §8.2. `pnpm test:db tests/db/seed-fabric.test.ts` 1 file/6 tests pass (pinned dedupe_keys in test). `pnpm test:db tests/db/seed-determinism.test.ts` 1/1 pass. `pnpm lint` 0 errors (11 pre-existing warnings elsewhere). `pnpm typecheck` clean.
Tests not run: full test:db/test:security left to checkpoints (BRIEF-COMMON).
Limitations: demo tenant seeds 0 mastery-gap insights/plans until detector.ts fix lands.
Security/integration risks: none new — same RPC/transaction pattern as exams.ts; no schema/RLS change.
Follow-ups: fix detector.ts planAuthor (above), then flip seed-fabric.test.ts's skip assertion.
New dependencies: none
Assumptions: principal is the correct actor for all 3 RPCs (owner/principal/admin all hold review rights, 0092).
