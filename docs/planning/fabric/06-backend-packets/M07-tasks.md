# M07 — Timetable

Source: `07-master-plan-v1-v2.md` §3 M7. Migration `0069` (claimed). No new deps. New owning module `src/modules/timetable` (owns rooms, periods, timetable_versions, timetable_slots). Replaces fixtures `TimetableConflict`, `TeacherWorkload`, `RoomUtilisation` (`src/modules/fabric/types.ts`) and `demoTimetable` (`TimetablePeriod[]`, `src/components/widgets/timetable-widget.tsx`).

Rulings:
- **Conflicts are DB constraints.** `timetable_slots` unique `(version_id, class_section_id, weekday, period_id)`, `(version_id, teacher_id, weekday, period_id)`, partial `(version_id, room_id, weekday, period_id) where room_id is not null`. Actions map `23505` → `conflict` with `fieldErrors` naming `section` / `teacher` / `room` by constraint name.
- Weekday 1–6 (Mon–Sat). `periods` = the school's bell schedule (seq, name, starts_at, ends_at, is_break); slots never point at a break period (trigger).
- Versions: `draft | published | archived`; one published per (institution, academic_year) (partial unique). `public.publish_timetable(p_version_id)` definer: owner/principal/admin, draft only, archives the previous published version of that year, sets published under GUC `app.allow_timetable_publish`, audits. Guard triggers: version status changes only under the GUC; slots insert/update/delete only while their version is `draft`.
- RLS: `rooms`, `periods` SELECT all active members; writes owner/principal/admin. `timetable_versions`/`timetable_slots` SELECT: owner/principal/admin all; other staff roles published only; guardian/student published slots whose `class_section_id = any((select app.my_student_section_ids()))`. Writes owner/principal/admin, every FK bound to the institution (lesson 2), initPlan helpers (lesson 7).
- Permissions: `timetable.manage` = owner, principal, admin; `timetable.read` = all 9 roles (RLS scopes).
- Workload: `max_periods` = `settings.timetable.max_periods_week` (default 36). `leave_dates` = `[]` until M8. Conflicts query reports `room_capacity` (room capacity < active enrolment of the section) and teacher overload (`teacher_unavailable` kind, suggestion text) — double-booking is impossible by constraint.

Routing (owner: Sonnet + Haiku only): T1 inline; T3 Haiku; T2, T4, T5, T6, T7 Sonnet. Parallel: T2 ‖ T3 → T4 ‖ T5 ‖ T6 → T7.

Every new action: manifest import + C-03 fixture. Every new query: `query-defs.ts` + `all-queries.ts` + smoke sample in `tests/db/api-query-route.test.ts`. Seed-imported files: relative `.ts` imports only.

---

### Task 1: M07-T1 Permissions `timetable.manage`, `timetable.read` (inline)

### Task 2: M07-T2 Migration 0069 — rooms, periods, versions, slots, publish RPC
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000068_announcements.sql` (publish RPC + guard pattern), `…0020*.sql` (`app.my_student_section_ids`), `…0036*.sql` (FK binding)
FILES: `supabase/migrations/20261028000069_timetable.sql`; `tests/db/timetable-rls.test.ts`; `src/lib/db/types.ts` (regen)
EXPORTS: tables per rulings (all with institution_id, created_at/updated_at + `set_updated_at`; rooms: name 1–40 unique per institution, capacity 1–500; periods: seq 1–12 unique per institution, name 1–30, starts_at < ends_at, is_break; versions: academic_year_id, name 1–60, status, published_at, published_by, created_by); constraints, guards, RLS, `publish_timetable` (wrapper `public.*` to authenticated only).
TEST FIRST: admin builds a draft with 2 slots; same teacher same weekday+period in another section → 23505; same room double-booked → 23505; slot on a break period → rejected; publish → published, previous published archived; edit slot after publish → rejected; guardian sees only own child's section's published slots; teacher sees published, not drafts; admin of A cannot reference B's teacher/room.
ACCEPT: `pnpm test:db tests/db/timetable-rls.test.ts`; `pnpm test:security` (update expectations if needed — say so); `pnpm lint`; `pnpm typecheck`

### Task 3: M07-T3 Timetable Zod schemas (Haiku)
READ: BRIEF-COMMON.md; `src/modules/announcements*` → use `src/modules/notifications/announcements.schemas.ts` and `src/lib/schemas/common.ts` as the pattern
FILES: `src/modules/timetable/schemas.ts` (relative `.ts` imports); `tests/unit/timetable-schemas.test.ts`
EXPORTS: `RoomUpsertSchema` {id?, name 1–40, capacity int 1–500, kind? ≤ 30}; `PeriodUpsertSchema` {id?, seq int 1–12, name 1–30, startsAt "HH:MM", endsAt "HH:MM" (refine start < end), isBreak?}; `VersionCreateSchema` {academicYearId uuid, name 1–60, copyFromVersionId? uuid}; `SlotInputSchema` {classSectionId, weekday int 1–6, periodId, subjectId, teacherId uuid, roomId? uuid}; `SaveSlotsSchema` {versionId, slots: SlotInputSchema[] 1–500, replaceSectionIds?: uuid[] ≤ 100}; `PublishVersionSchema` {versionId}; `ForSectionSchema` {classSectionId, versionId?}; `ForTeacherSchema` {staffId?, versionId?}; `ForStudentSchema` {studentId}; `VersionQuerySchema` {versionId}. All `.strict()`.
TEST FIRST: valid inputs parse; weekday 7 rejected; "9:5" time rejected; endsAt ≤ startsAt rejected; 501 slots rejected; unknown key rejected.
ACCEPT: `pnpm test tests/unit/timetable-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 4: M07-T4 Timetable actions
READ: BRIEF-COMMON.md; rulings; Task 2 migration; Task 3 schemas; `src/modules/notifications/announcements.actions.ts` (style, 42501/23505 mapping)
FILES: `src/modules/timetable/actions.ts` (`"use server"`); `tests/db/timetable-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (all `timetable.manage`, audited ids/counts only): `timetable.room.upsert`; `timetable.period.upsert`; `timetable.version.create` (optional copy of another version's slots); `timetable.saveDraft` (deletes slots of `replaceSectionIds` in the draft, inserts `slots`; one bad slot fails the call with `conflict` + `fieldErrors.slots: ["<index>: teacher|room|section double-booked"]`); `timetable.publish` → RPC.
TEST FIRST: build rooms/periods/version, save, publish; teacher double-booked → conflict naming teacher; teacher role → forbidden; saveDraft on a published version → invalid_state.
ACCEPT: `pnpm test:db tests/db/timetable-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: M07-T5 Timetable queries
READ: BRIEF-COMMON.md; rulings; fixture types named above; `src/modules/documents/queries.ts` + `query-defs.ts` (pattern)
FILES: `src/modules/timetable/queries.ts`; `src/modules/timetable/query-defs.ts`; `tests/db/timetable-queries.test.ts`; + `all-queries.ts` line + smoke samples
EXPORTS (permission `timetable.read`; default version = the current year's published one): `timetable.forSection` → `{ weekday, period: {seq, name, startsAt, endsAt}, subject, teacher, room }[]`; `timetable.forTeacher` (default: caller's own `staffId`); `timetable.forStudent` (resolves the student's active enrolment section; RLS decides visibility); `timetable.todayFor` → `TimetablePeriod[]` for the caller (teacher: own slots; guardian/student: first child/own section) for today's weekday in the institution timezone, breaks included, `isCurrent`/`isNext` set — the `demoTimetable` replacement; `timetable.conflicts` {versionId} → `TimetableConflict[]`; `timetable.teacherWorkload` {versionId} → `TeacherWorkload[]`; `timetable.roomUtilisation` {versionId} → `RoomUtilisation[]` (periods_total = 6 × non-break periods). `conflicts`/`teacherWorkload`/`roomUtilisation` require `timetable.manage`.
TEST FIRST: forSection returns the published grid; guardian forStudent of another family's child → empty; todayFor marks current/next with a mocked clock; workload counts periods/week; a room smaller than its section's strength appears as `room_capacity`.
ACCEPT: `pnpm test:db tests/db/timetable-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 6: M07-T6 Seed section `timetable`
READ: BRIEF-COMMON.md; `scripts/seed/index.ts`, `scripts/seed/sections/academics.ts` (subject_assignments), `scripts/seed/lib/*`; `tests/db/seed-*.test.ts`
FILES: `scripts/seed/sections/timetable.ts` (new); `scripts/seed/index.ts` (register after academics); `tests/db/seed-timetable.test.ts` (new)
EXPORTS: deterministic (seeded PRNG/uuidV5): one room per section (capacity 45) + a hall; 8 teaching periods + short break + lunch (times matching `SLOTS` in `src/modules/core/demo/fixtures.ts`); one published version for the current year filling Mon–Sat for every section from its `subject_assignments`, greedy round-robin that never double-books a teacher or room (skip a cell rather than conflict). Fast: bulk inserts via `insertBatch`.
TEST FIRST: demo tenant has a published version; every section has ≥ 40 filled cells; no teacher double-booked (query); reseed gives identical slot ids.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset` (you are the seed owner); `pnpm test:db tests/db/seed-timetable.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 7: M07-T7 Acceptance over HTTP
FILES: `tests/db/timetable-acceptance.test.ts`
TEST: admin via `/api/v1/actions/*` creates rooms/periods/version, saves two sections, a double-booked teacher → 409 `conflict`, publishes; guardian `GET /api/v1/query/timetable.forStudent` for own child → grid, for another child → empty; teacher `timetable.todayFor` → own periods.
ACCEPT: `pnpm test:db tests/db/timetable-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Controller after T7: `07 §4` row (`publish_timetable`); backlog index 0069 built; security review (Sonnet); full gate; commit/push; hosted push owner-run; `DONE M07 <sha>`.
