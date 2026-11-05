Packet: X08-T2 Migration 0099 part A — PTM tables, RLS, definers, app.module_catalog insert
Files changed: supabase/migrations/20261028000099_ptm_surveys.sql (new); tests/db/ptm-rls.test.ts (new); tests/security/rls-expectations.ts (+4 entries); tests/security/grants.test.ts (+3 public fns); src/lib/db/types.ts (regen)
Behavior implemented: ptm_events/ptm_event_sections/ptm_slots/ptm_bookings tables + RLS; app.guard_ptm_events_update (draft->published only, stamps published_at/by); app.guard_ptm_slots_write (seq bound, blocks delete of booked slot); app.section_teacher_ids (internal); app.ptm_slots_for_student/book_ptm_slot/cancel_ptm_booking (app.* + public.* wrapper split); app.module_catalog insert for 'ptm'. Reused existing app.my_staff_ids (0070) and app.my_taught_section_ids (0020) per rulings instead of redefining.
Tests run: `pnpm test:db tests/db/ptm-rls.test.ts` → 8 passed; `pnpm test:db tests/db/module-enabled-sql.test.ts` → 8 passed; `pnpm test:security` → 19 files, 2236 passed; `pnpm lint` clean; `pnpm typecheck` clean. `pnpm db:reset` ran clean (full seed, 78s).
Tests not run and why: tests/db/surveys-rls.test.ts (T3, not written yet — surveys section appended by T3 to the same file).
Limitations / honesty label: none new (X08 honesty label is T11's job).
Security / integration risks: none identified; guard triggers carry no service-role bypass by design (ruling: seed inserts final states via INSERT, guards only fire on UPDATE/the specific INSERT/DELETE shapes seed data already satisfies).
Follow-ups: T3 appends surveys part B to this same migration file (unmerged) + 4 more rls-expectations entries.
New dependencies (justification): none
Assumptions made: PolicyClass tags in rls-expectations.ts are documentation only (unused by generated suite, confirmed by grep) — chose C/T/S+G/O per nearest precedent (student_leave_requests, question_bank).
