### Task 7: M07-T7 Acceptance over HTTP
FILES: `tests/db/timetable-acceptance.test.ts`
TEST: admin via `/api/v1/actions/*` creates rooms/periods/version, saves two sections, a double-booked teacher → 409 `conflict`, publishes; guardian `GET /api/v1/query/timetable.forStudent` for own child → grid, for another child → empty; teacher `timetable.todayFor` → own periods.
ACCEPT: `pnpm test:db tests/db/timetable-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Controller after T7: `07 §4` row (`publish_timetable`); backlog index 0069 built; security review (Sonnet); full gate; commit/push; hosted push owner-run; `DONE M07 <sha>`.
