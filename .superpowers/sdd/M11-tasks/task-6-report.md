Packet: M11-T6 Schedule conflict detector (pure)
Files changed: src/modules/exams/schedule-conflicts.ts (new); tests/unit/exam-schedule-conflicts.test.ts (new)
Behavior implemented: `institutionTimeZone(settings)` (locale.timezone, fallback Asia/Kolkata), `localParts(iso, tz)` (date/weekday 0=Sun/hhmm), `detectScheduleConflicts(papers, roomSlots, tz)`: section_double_booked via half-open epoch-ms overlap per (classSectionId) pair; room_timetable_clash via local weekday+minute overlap against roomSlots, skipping Sunday/no-room, end clamped to 24:00 for midnight-crossing papers; result sorted by starts_at.
Tests run: `pnpm test tests/unit/exam-schedule-conflicts.test.ts` → 12 passed, 0 failed (RED confirmed first: "Cannot find module" before file existed). `pnpm lint` clean. `pnpm typecheck` clean.
Tests not run and why: none skipped — pure module, no DB/security suites apply.
Limitations / honesty label: none — no UI, no simulated channel.
Security / integration risks: none; pure function, no DB/auth touched.
Follow-ups: T7 wires this into exams.schedule / exams.scheduleConflicts queries (fetches papers + room slots from DB, calls detectScheduleConflicts).
New dependencies (justification): none
Assumptions made: room_timetable_clash's `other_exam_paper_id` is null (slot isn't a paper); section_double_booked's exam_paper_id/other_exam_paper_id = earlier/later paper by input array order, not re-sorted before pairing.
