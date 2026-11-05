# X01-T5 Migration 0085 part 2 — completion report

Packet: X01-T5 Migration 0085 part 2 — diary
Files changed:
- `supabase/migrations/20261028000085_student_leave_diary.sql` (appended)
- `tests/db/diary-rls.test.ts` (new)
- `src/lib/db/types.ts` (regen, raw `pnpm db:types`)
- `tests/security/rls-expectations.ts` (+2 entries: `diary_entries`, `diary_acknowledgements`)

Behavior implemented: `diary_entries` (section/subject FK bound to own institution, lesson 2; INSERT admin or taught-section teacher; DELETE author or admin; no UPDATE policy); `app.enqueue_diary_entry_notification` AFTER INSERT trigger enqueuing `notify.diary_entry {entry_id}`, bypassed under the lesson-5 predicate; `diary_acknowledgements` (unique entry+student; INSERT guardian-only, own child, `requires_ack` entry, active enrolment in its section; SELECT admin/own-student/teacher-of-section; no UPDATE/DELETE — cascade on entry delete).

Tests run: `pnpm db:reset` clean (all migrations incl. 0085 + 0099 applied; seed 82s). `pnpm db:types` regen (451 lines, pure additions). `pnpm test:db tests/db/diary-rls.test.ts tests/db/student-leave-rls.test.ts` → 2 files, 38/38 passed. `pnpm test:security` → 19 files, 2290/2290 passed. `pnpm test:db tests/db/module-enabled-sql.test.ts` → 8/8 passed (T4's noted pre-existing failure now resolved — 0099 landed). `pnpm lint` → clean. `pnpm typecheck` → clean.

Tests not run and why: none blocked.

Limitations / honesty label: none; no UI, no honesty badge applicable.

Security / integration risks: none identified for this diff. Cascade delete of acks on entry delete verified empirically (RI cascade bypasses the child table's missing DELETE policy, as the ruling assumed).

Follow-ups: T6–T9 (actions/queries) build on this SQL; T10 wires `notify.diary_entry`.

New dependencies: none.

Assumptions made: "admin of A with B's section or subject -> 42501" split into two explicit tests (section case, subject case) for clarity; teacher-ack-read-scope test used `accountant` (not a second guardian account — fixture has one guardian slot per institution) to prove the negative read case.
