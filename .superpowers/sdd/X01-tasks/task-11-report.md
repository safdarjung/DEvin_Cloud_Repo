Packet: X01-T11 Acceptance over HTTP

Files changed:
- tests/db/x01-acceptance.test.ts (new)
- src/modules/core/schemas.ts (+1 line: SetModuleEnabledSchema key enum was missing ptm/student_leave/diary)

Behavior implemented: Full HTTP flow via /api/v1/actions + /api/v1/query on one fixture institution: attendance.mark+submit (prev school day, child A) -> studentLeave.request (own child 200, other family 403, overlap 409) -> studentLeave.approve (wrong-section teacher 403, class teacher 200; asserted OL + attendance_corrections row + attendance.corrected audit on prev day, open OL session on next school day) -> job runner once -> guardian notifications.listMyNotifications + studentLeave.list show the decision -> diary.entry.post requiresAck -> job runner -> diary.forStudent (acknowledged:false) -> diary.acknowledge x2 (idempotent) -> diary.ackStatus (acknowledged) -> unrelated guardian's diary.forStudent -> [] -> owner core.module.set diary off (403 MODULE_DISABLED_MESSAGE on post) -> back on.

Tests run: `pnpm test:db tests/db/x01-acceptance.test.ts` -> 1/1 passed. `pnpm lint` -> clean. `pnpm typecheck` -> clean.

Tests not run and why: none blocked; no other test files touched.

Limitations / honesty label: none; no UI, no badge applicable.

Security / integration risks: none new. The schemas.ts fix is a pre-existing gap (T1 added ptm/student_leave/diary to MODULE_KEYS/catalog but SetModuleEnabledSchema's hand-written enum wasn't grown to match) that silently made `core.module.set` validation_failed for all 3 new modules; fixed as a one-line array append since T11's required step 6 needs `core.module.set({key:"diary"})` to work. No other file in that enum's blast radius touched.

Follow-ups: none for T11.

New dependencies: none.

Assumptions made: "previous school day"/"next school day" = nearest Mon-Sat day before/after institution-local today (Asia/Kolkata), skipping Sunday, computed in JS to match the SQL guard/markAttendance's own tz default; today itself (which falls between them) is not asserted on, matching the ruling's literal wording (only prev/next day checked) even though the premark loop also touches today's date as a side effect.
