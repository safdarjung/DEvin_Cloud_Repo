Packet: T-0NN M08-T7 Staff attendance actions (mark/checkIn) + db test + C-03
Files changed: src/modules/people/staff-attendance.actions.ts (new); tests/db/staff-attendance-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import); tests/security/escalation.test.ts (+2 fixtures)
Behavior implemented: people.staffAttendance.mark (RLS upsert staff_id,date; owner/pri/adm only; rejects staff on approved leave, invalid_state naming index; date-not-future); people.staffAttendance.checkIn (staff_check_in RPC wrapper, forbidden with no staffId).
Tests run: pnpm test:db tests/db/staff-attendance-actions.test.ts -> 6/6 pass. pnpm test tests/unit/action-names-unique.test.ts -> 4/4 pass. pnpm test:security tests/security/escalation.test.ts -> 842/842 pass. pnpm lint -> 0 errors (1 pre-existing warning, hr.queries.ts, not mine).
Tests not run: full test:db/db:reset/seed (brief: own files only).
Limitations / honesty label: no UI this milestone (per rulings); no notification on mark/check-in.
Security / integration risks: none found; mark narrows broader `staff.attendance.mark` permission to owner/pri/adm in handler (createClient() called first so C-03 reaches a real boundary, mirrors attendance.mark's class-teacher narrowing).
Follow-ups: none new.
New dependencies: none.
Assumptions made: action/permission names per rulings (`people.staffAttendance.mark`/`.checkIn`, both on `staff.attendance.mark`); RLS 42501 on insert mapped to validation_failed (lesson 2), untested directly (not in TEST FIRST list).
Not mine, pre-existing at run time: `pnpm typecheck` fails in src/modules/academics/curriculum.actions.ts (concurrent T-other packet, untouched by me).
