### Task 3: M07-T3 Timetable Zod schemas (Haiku)
READ: BRIEF-COMMON.md; `src/modules/announcements*` → use `src/modules/notifications/announcements.schemas.ts` and `src/lib/schemas/common.ts` as the pattern
FILES: `src/modules/timetable/schemas.ts` (relative `.ts` imports); `tests/unit/timetable-schemas.test.ts`
EXPORTS: `RoomUpsertSchema` {id?, name 1–40, capacity int 1–500, kind? ≤ 30}; `PeriodUpsertSchema` {id?, seq int 1–12, name 1–30, startsAt "HH:MM", endsAt "HH:MM" (refine start < end), isBreak?}; `VersionCreateSchema` {academicYearId uuid, name 1–60, copyFromVersionId? uuid}; `SlotInputSchema` {classSectionId, weekday int 1–6, periodId, subjectId, teacherId uuid, roomId? uuid}; `SaveSlotsSchema` {versionId, slots: SlotInputSchema[] 1–500, replaceSectionIds?: uuid[] ≤ 100}; `PublishVersionSchema` {versionId}; `ForSectionSchema` {classSectionId, versionId?}; `ForTeacherSchema` {staffId?, versionId?}; `ForStudentSchema` {studentId}; `VersionQuerySchema` {versionId}. All `.strict()`.
TEST FIRST: valid inputs parse; weekday 7 rejected; "9:5" time rejected; endsAt ≤ startsAt rejected; 501 slots rejected; unknown key rejected.
ACCEPT: `pnpm test tests/unit/timetable-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`

