# X01-T10 Templates + job handlers — completion report

Packet: X01-T10 Templates + job handlers
Files changed:
- `src/modules/notifications/templates.ts` (+2 types: `student_leave_decided`, `diary_entry`, vars schemas, en/hi bodies)
- `src/modules/jobs/handlers/notify.student_leave_decided.ts` (new)
- `src/modules/jobs/handlers/notify.diary_entry.ts` (new)
- `src/modules/jobs/handlers/index.ts` (register both)
- `src/modules/jobs/registry.ts` (+2 `JOB_MODULES` rows, +2 `JOB_REGISTRY` entries)
- `src/modules/jobs/types.ts` (+2 `JobType`)
- `src/modules/jobs/handlers/notify.announcement.ts` (`export` on `guardiansAndStudents`, `resolveRecipients`, no logic change)
- `tests/db/notify-x01.test.ts` (new)

Behavior implemented: `notifyStudentLeaveDecided` (re-reads leave row, skips unless still approved/rejected, notifies guardians-with-portal-access + student via `guardiansAndStudents`, never includes reason/decision_note); `notifyDiaryEntry` (re-reads entry, skips if deleted, resolves section audience via `resolveRecipients`, in-app only, excerpt ≤120 chars, subject "General" when null).

Tests run: `pnpm test:db tests/db/notify-x01.test.ts tests/db/notify-announcement.test.ts tests/db/jobs.test.ts` → 3 files, 21/21 passed (one unrelated `jobs_requeue` timeout on first run, 11/11 on retry — pre-existing flake, unrelated to this packet). `pnpm test tests/unit/notification-templates.test.ts tests/unit/jobs-runner.test.ts` → 2 files, 40/40 passed. `pnpm lint` → clean (2 pre-existing warnings in another lane's `tests/db/survey-queries.test.ts`, not touched here). `pnpm typecheck` → clean.

Tests not run and why: none blocked.

Limitations / honesty label: none; no UI, no new simulated channel (SMS reuses the existing simulated adapter + its badge, per rulings "no new badge").

Security / integration risks: none identified. Both handlers re-check state at send time and never render payload-sourced free text (lesson 10).

Follow-ups: T11 (acceptance-over-HTTP) exercises both handlers end to end via the job runner.

New dependencies: none.

Assumptions made: `student_leave_decided` SMS body interpolates `decision` verbatim ("approved"/"rejected") in both en/hi, matching the existing `recheck_decided` template's pattern of embedding an English decision word in Hindi text.
