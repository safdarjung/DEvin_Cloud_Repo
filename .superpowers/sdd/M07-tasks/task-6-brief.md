### Task 6: M07-T6 Seed section `timetable`
READ: BRIEF-COMMON.md; `scripts/seed/index.ts`, `scripts/seed/sections/academics.ts` (subject_assignments), `scripts/seed/lib/*`; `tests/db/seed-*.test.ts`
FILES: `scripts/seed/sections/timetable.ts` (new); `scripts/seed/index.ts` (register after academics); `tests/db/seed-timetable.test.ts` (new)
EXPORTS: deterministic (seeded PRNG/uuidV5): one room per section (capacity 45) + a hall; 8 teaching periods + short break + lunch (times matching `SLOTS` in `src/modules/core/demo/fixtures.ts`); one published version for the current year filling Mon–Sat for every section from its `subject_assignments`, greedy round-robin that never double-books a teacher or room (skip a cell rather than conflict). Fast: bulk inserts via `insertBatch`.
TEST FIRST: demo tenant has a published version; every section has ≥ 40 filled cells; no teacher double-booked (query); reseed gives identical slot ids.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset` (you are the seed owner); `pnpm test:db tests/db/seed-timetable.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`

