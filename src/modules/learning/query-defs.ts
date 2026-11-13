// Phase 5 — learning analytics at /api/v1/query/learning.<fn>. Scope is
// enforced in the 0151 definer functions; the permission here is the first layer.
import { defineQuery } from "@/lib/actions/define-query";
import { MyLearningSchema, SectionSubjectSchema, TestSectionSchema } from "@/modules/learning/schemas";
import {
  myProgress,
  myWeakTopics,
  practiceBankCounts,
  revisionListQuery,
  sectionGapsQuery,
  testSectionQuestions,
} from "@/modules/learning/queries";

const MODULE = "mastery" as const;

export const learningMyWeakTopicsQuery = defineQuery({
  name: "learning.myWeakTopics",
  module: MODULE,
  schema: MyLearningSchema,
  permission: "mastery.read",
  handler: (input, ctx) => myWeakTopics(ctx, input),
});

export const learningMyProgressQuery = defineQuery({
  name: "learning.myProgress",
  module: MODULE,
  schema: MyLearningSchema,
  permission: "mastery.read",
  handler: (input, ctx) => myProgress(ctx, input),
});

export const learningPracticeBankCountsQuery = defineQuery({
  name: "learning.practiceBankCounts",
  module: MODULE,
  schema: MyLearningSchema,
  permission: "mastery.read",
  handler: (input, ctx) => practiceBankCounts(ctx, input),
});

export const learningSectionGapsQuery = defineQuery({
  name: "learning.sectionGaps",
  module: MODULE,
  schema: SectionSubjectSchema,
  permission: "mastery.review",
  handler: (input, ctx) => sectionGapsQuery(ctx, input),
});

export const learningRevisionListQuery = defineQuery({
  name: "learning.revisionList",
  module: MODULE,
  schema: SectionSubjectSchema,
  permission: "mastery.review",
  handler: (input, ctx) => revisionListQuery(ctx, input),
});

export const learningTestQuestionsQuery = defineQuery({
  name: "learning.testQuestions",
  module: MODULE,
  schema: TestSectionSchema,
  permission: "mastery.review",
  handler: (input, ctx) => testSectionQuestions(ctx, input),
});
