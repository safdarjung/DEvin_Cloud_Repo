Packet: M10-T2 Curriculum Zod schemas + unit test

Files changed:
- src/modules/academics/curriculum.schemas.ts (new)
- tests/unit/curriculum-schemas.test.ts (new)

Behavior implemented:
7 Zod schemas exported for curriculum domain: CurriculumUnitUpsertSchema (title/desc/seq limits), LessonPlanUpsertSchema (with coveredOn refinement), LessonPlanDeleteSchema, MarkCoveredSchema (covered=true enforces coveredOn), CoverageQuerySchema, SectionUnitsQuerySchema, LessonPlansQuerySchema (with from≤to refinement). All .strict(), strings trimmed. Types: z.infer'd *Input variants.

Tests run: `pnpm test tests/unit/curriculum-schemas.test.ts` → 44 passed (all TDD RED→GREEN)

Tests not run and why: None skipped. Full suite executes per task.

Limitations / honesty label: None; real data, no simulation.

Security / integration risks: None; schemas are data validation only, no state/auth side effects.

Follow-ups: None at this stage; upstream T3 (actions) uses these exports.

New dependencies (justification): None.

Assumptions made: uuid from common.ts, isoDate from common.ts (preexisting imports per pattern). refine for covered/to validation (Zod idiom, aligns with timetable.schemas.ts pattern).
