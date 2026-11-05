Packet: M16-T14 Perf budget + acceptance
Files changed: tests/db/dashboard-perf.test.ts (new)
Behavior implemented: 9 cases, real GET/POST route (next/headers mocked only, Supabase not mocked — real bearer tokens via signInWithPassword, auth+ctx+module+permission+RLS all run). 1 warm-up + 3 timed calls/case, asserts 200+ok+median<1500ms.
Medians (ms): principal→dashboard.principal 106; principal→core.approvals.pending 20; principal→dashboard.attendanceTrend{92} 121; admin→dashboard.operations 66; accountant→dashboard.finance 50; admissions→dashboard.admissions 25; teacher.vi-a→dashboard.teacher 129; guardian.one→dashboard.parent 77; student.one→dashboard.student 81.
Tests run: `pnpm test:db tests/db/dashboard-perf.test.ts` → 9/9 pass. `pnpm exec eslint tests/db/dashboard-perf.test.ts` → clean. `pnpm lint` (full) → clean. `pnpm typecheck` (full) → clean.
Tests not run and why: `pnpm test:e2e e2e/j13-dashboard.spec.ts e2e/j06-attendance.spec.ts e2e/j07-guardian-portal.spec.ts` — blocked. Next.js refuses a 2nd dev server in this dir (lock), so I reused this lane's already-running leftover (:3123, PID 465621, left by T12). `curl /login` on it → 500, same pre-existing bug T12 already reported: `throwMappedSchedule` exported non-async from `"use server"` src/modules/exams/actions.ts breaks every page's /login. Not my file, 2 prior tasks already confirmed root cause — did not attempt a fix.
Limitations / honesty label: none; test-only, no UI/badge change.
Security / integration risks: none new; reuses existing routes/queries, no new SQL.
Follow-ups: unblock e2e (T10/T11/T12/T14 all share this) by fixing `src/modules/exams/actions.ts` `throwMappedSchedule` export (make non-exported or move out of the `"use server"` file).
New dependencies: none.
Assumptions made: "first child" for guardian.one = lowest student_id among their portal_access children (T9 test precedent). DB perf test is the T14 deliverable; e2e acceptance deferred to the exams-module fix above.
