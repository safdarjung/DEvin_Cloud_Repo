Packet: M11-T11 Acceptance over HTTP
Files changed: tests/db/question-bank-schedule-acceptance.test.ts (new)
Behavior implemented: one HTTP acceptance test (real bearer tokens + real RLS, no server-client mock, mirrors timetable-acceptance.test.ts): teacher POST questionBank.create in scope -> ok, exam_controller creates an out-of-scope question; guardian/student direct PostgREST select question_bank -> []; insert -> error; teacher questionBank.list -> taught scope only; exam_controller schedules a paper via exam.paper.schedule into a room a published timetable uses -> GET exams.scheduleConflicts lists room_timetable_clash, exams.schedule shows it "scheduled"; separate exam marked+published for one student -> guardian GET exams.reportCardHtml?format=html for own child -> 200 text/html with child's name, another family's child -> 404.
Tests run: pnpm test:db tests/db/question-bank-schedule-acceptance.test.ts -> 1 file, 1 test, pass. pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: full test:db / test:security (lane rule: own file only).
Limitations / honesty label: none new; reuses T4/T5/T7/T8/T10 behavior as-is.
Security / integration risks: none found; direct-PostgREST negative checks confirm no policy for guardian/student on question_bank.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: institution grading settings (locale/exams.grading_scales) set via sql patch before exam create/publish, same pattern as tests/db/exams-publish.test.ts — not asserted by the ruling but needed for publish_exam_results to run end to end.
