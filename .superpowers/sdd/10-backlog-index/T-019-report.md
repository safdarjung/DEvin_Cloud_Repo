Packet: T-019 — Publish results, report card, results notifications

Files changed:
- src/modules/exams/grade.ts (new)
- src/modules/exams/actions.ts (added publishExamResults)
- src/modules/exams/queries.ts (added getCurrentResult, listResultsForExam, listResultsForStudent, getResultHistory)
- src/modules/exams/components/ReportCard.tsx (new)
- src/modules/exams/components/PublishButton.tsx (new)
- src/modules/exams/components/ResultsTable.tsx (new)
- src/app/(tenant)/[institution]/exams/[examId]/results/page.tsx (new)
- src/app/(tenant)/[institution]/exams/[examId]/results/[studentId]/page.tsx (new)
- src/modules/jobs/handlers/notify.results_published.ts (new — lead-authorized carve-out)
- src/modules/jobs/handlers/index.ts (wired the new handler in, replacing the placeholder)
- tests/unit/grade-for.test.ts (new)
- tests/db/exams-publish.test.ts (new)
- tests/db/notify-results-published.test.ts (new)
- tests/unit/jobs-runner.test.ts (its "still a placeholder" example switched from notify.results_published to notify.recheck_decided, per lead ruling)
- e2e/j10-publish-results.spec.ts (new, not run)

Not touched: src/modules/notifications/templates.ts — the results_published template (EN/HI) already existed from T-038 with exactly the vars shape this packet needs ({student, exam, school}); no change was needed there. supabase/migrations/**, tests/security/**, docs/planning/**, admissions/finance/people modules, students pages — all left alone (T-028 phase 2's scope).

Behavior implemented:
- publishExamResults action (exam.result.publish) proves the exam belongs to ctx.institution before calling public.publish_exam_results(p_exam_id) (actions.ts:219-243) — the RPC itself takes no institution id.
- Reads: getCurrentResult (current version only, pure RLS scope), listResultsForExam (class list + grade distribution), listResultsForStudent (portal list across exams), getResultHistory (all versions, gated server-side to owner/principal/admin/exam_controller via EXAM_HISTORY_ROLES, queries.ts:333,563 — not just hidden in the UI).
- ReportCard (server component), PublishButton (disabled until verification clean, confirm dialog states "cannot be undone; corrections only via recheck"), ResultsTable (grade distribution + links), two pages wiring them together.
- notify.results_published handler: re-reads student/exam/institution from current DB rows, re-checks the result is still current (superseded_by is null) and the exam is still published before sending (handler:28,39), notifies every guardian with an active membership linked to the student plus the student's own active membership (handler:93,105) — not just the primary guardian.

Permission and scope proofs (file:line):
- src/modules/exams/actions.ts:219-243 — publishExamResults: permission "exam.result.publish" (221), exam ownership check `.eq("institution_id", ctx.institution.id)` before the RPC call (234).
- src/modules/exams/queries.ts:333,563 — getResultHistory checked server-side against EXAM_HISTORY_ROLES, returns null for any other role (guardian/student/teacher all hold exam.result.read but never reach version history).
- src/modules/exams/queries.ts:452,496,537 — getCurrentResult/listResultsForExam/getResultHistory all filter `.is("superseded_by", null)` for "current version" reads (listResultsForStudent too, not shown above).
- RLS (0009 results_select, read-only in this packet) is the actual enforcement for guardian/student scope — getCurrentResult never takes institution_id from the client and adds `.eq("institution_id", ctx.institution.id)` as defense in depth on top of it.

Handler idempotency and recipient tests:
- tests/db/notify-results-published.test.ts: "notifies every linked guardian and the student's own membership... and is idempotent on rerun" — asserts exactly 3 recipients (primary guardian, a second non-primary guardian, the student), in-app + SMS delivery_attempts for the guardian, a "failed: no_contact" SMS attempt for the student (no phone column on students), then reruns the handler and asserts no duplicate notifications/attempts.
- Same file: "skips... when the result has since been superseded", "skips... when the result row no longer exists", "a disabled guardian membership gets no notification".

Grade parity:
- tests/unit/grade-for.test.ts: TS mirror (gradeFor) against the packet's named boundaries (32.99→E1, 33→D, 40→D, 41→C2, 90.99→A2, 91→A1, 100→A1).
- tests/db/exams-publish.test.ts: after a real publish, compares the published result's stored grade, the TS mirror's output, and a live call to `app.grade_for(...)` in the same test — all three agree, not just fixed constants.

Tests run:
- `pnpm vitest run --project unit tests/unit/grade-for.test.ts` → 8 passed
- `pnpm vitest run --project db tests/db/exams-publish.test.ts` → 1 passed (publish, invalid_state x2, forbidden, result rows, jobs enqueued, grade parity, guardian scope, teacher/controller list)
- `pnpm vitest run --project db tests/db/notify-results-published.test.ts` → 4 passed
- `pnpm vitest run --project db tests/db/exams-actions.test.ts tests/db/notifications.test.ts tests/db/jobs.test.ts` (regression check, own files + adjacent) → all passed
- `pnpm test` (full unit suite) → 305 passed, 29 files
- `pnpm lint` → clean on every file this packet touched (3 pre-existing warnings elsewhere, untouched files)
- `pnpm tsc --noEmit` (full repo) → clean

Tests not run: `pnpm test:e2e -- e2e/j10-publish-results.spec.ts` — per lead instruction, written but not executed. Full `pnpm test:db` not run (packet scope: only this packet's db files + directly adjacent regression files).

Limitations / honesty label: no AI involved, no simulated-channel labels needed here. ResultsTable/ReportCard are plain data views — no honesty badge applicable.

Security / integration risks:
- e2e spec assumes `getPaperMarks`'s row order (no roll_no set) matches insertion order for the two fixture students — not guaranteed by SQL, acceptable since the spec is not run and the risk is documented inline.
- notify.results_published's SMS contact for the student recipient is always null (students table has no phone column) — by design, same as every other handler in this codebase; the in-app notification still reaches the student via their own membership.

Follow-ups: none new — recheck's own notify.recheck_decided handler is T-020's, already scoped there.

New dependencies: none.

Assumptions made:
- The results/page.tsx (class list + publish) is gated to owner/principal/admin/exam_controller/teacher (LIST_ROLES) even though exam.result.read is also granted to guardian/student — the matrix's "scoped" read for those two roles is a single student's own report card, never a class list, so this page would otherwise leak class-wide results to a guardian/student who found the URL.
- PublishButton is rendered only when ctx.permissions.has("exam.result.publish"); teachers reaching the results/page.tsx while an exam is in verification see a "Waiting for an exam controller to publish" message instead of a non-functional button.
- The existing exam/[examId]/page.tsx was left untouched (not in the packet's Expected changes) — there is no nav link from it to the new results page yet; it's reachable by URL (and from ResultsTable's own links once published). A future packet can add that link.

## Fix round 1 (LOW, code review)

- `src/app/(tenant)/[institution]/exams/[examId]/page.tsx`: added a "Publish / View results" link to `/${institutionSlug}/exams/${exam.id}/results`, gated by `ctx.permissions.has("exam.result.read")` AND a `RESULTS_LINK_ROLES` set (`owner`, `principal`, `admin`, `exam_controller`, `teacher`) — the same roles `results/page.tsx`'s own `LIST_ROLES` allows, so guardians/students never see it (they also fail this page's pre-existing top-level `requirePermission(ctx, "exam.manage")` gate regardless).
- `e2e/j10-publish-results.spec.ts`: step 3 now clicks the "Publish / View results" link instead of `page.goto`-ing the results URL directly.
- Verified: `pnpm tsc --noEmit` clean, `pnpm lint` clean (same 3 pre-existing unrelated warnings in scripts/seed/*), `pnpm test` → 305/305 passed. DB and e2e not run (T-016 owns the DB; e2e not run per original instruction), per this round's explicit instruction.
