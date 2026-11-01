### Task 2: M07-T2 Migration 0069 — rooms, periods, versions, slots, publish RPC
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000068_announcements.sql` (publish RPC + guard pattern), `…0020*.sql` (`app.my_student_section_ids`), `…0036*.sql` (FK binding)
FILES: `supabase/migrations/20261028000069_timetable.sql`; `tests/db/timetable-rls.test.ts`; `src/lib/db/types.ts` (regen)
EXPORTS: tables per rulings (all with institution_id, created_at/updated_at + `set_updated_at`; rooms: name 1–40 unique per institution, capacity 1–500; periods: seq 1–12 unique per institution, name 1–30, starts_at < ends_at, is_break; versions: academic_year_id, name 1–60, status, published_at, published_by, created_by); constraints, guards, RLS, `publish_timetable` (wrapper `public.*` to authenticated only).
TEST FIRST: admin builds a draft with 2 slots; same teacher same weekday+period in another section → 23505; same room double-booked → 23505; slot on a break period → rejected; publish → published, previous published archived; edit slot after publish → rejected; guardian sees only own child's section's published slots; teacher sees published, not drafts; admin of A cannot reference B's teacher/room.
ACCEPT: `pnpm test:db tests/db/timetable-rls.test.ts`; `pnpm test:security` (update expectations if needed — say so); `pnpm lint`; `pnpm typecheck`

