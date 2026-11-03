// M10-T4 — read-only wrappers over ./curriculum.queries.ts, exposed at
// /api/v1/query/curriculum.<fn> (mirrors src/modules/timetable/query-defs.ts).
// All three gate on academics.read (07 §2.2: every role reads academic
// structure); RLS does the real narrowing, and coverageBySection itself
// rejects guardian/student (academic_years is staff-only).
import { defineQuery } from "@/lib/actions/define-query";
import { CoverageQuerySchema, LessonPlansQuerySchema, SectionUnitsQuerySchema } from "./curriculum.schemas";
import { curriculumCoverageBySection, curriculumLessonPlans, curriculumSectionUnits } from "./curriculum.queries";

export const curriculumCoverageBySectionQuery = defineQuery({
  name: "curriculum.coverageBySection",
  module: "lesson_plans",
  schema: CoverageQuerySchema,
  permission: "academics.read",
  handler: (input, ctx) => curriculumCoverageBySection(ctx, input),
});

export const curriculumSectionUnitsQuery = defineQuery({
  name: "curriculum.sectionUnits",
  module: "academic_structure",
  schema: SectionUnitsQuerySchema,
  permission: "academics.read",
  handler: (input, ctx) => curriculumSectionUnits(ctx, input),
});

export const curriculumLessonPlansQuery = defineQuery({
  name: "curriculum.lessonPlans",
  module: "lesson_plans",
  schema: LessonPlansQuerySchema,
  permission: "academics.read",
  handler: (input, ctx) => curriculumLessonPlans(ctx, input),
});
