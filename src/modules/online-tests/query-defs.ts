// Phase 4 — read-only wrappers over ./queries.ts at /api/v1/query/<name>.
// Staff reads are scoped by RLS (0150); student and guardian reads go through
// definer RPCs that never return an answer key before the release policy says so.
import { defineQuery } from "@/lib/actions/define-query";
import { AttemptIdSchema, NoInputSchema, TestIdRefSchema, TestIdSchema, TestListSchema } from "@/modules/online-tests/schemas";
import { getAttemptPaper, getTest, listTests, markingQueue, myTests, testAnalytics, testResult } from "@/modules/online-tests/queries";

const MODULE = "exams" as const;

export const onlineTestsListQuery = defineQuery({
  name: "onlineTests.list",
  module: MODULE,
  schema: TestListSchema,
  permission: "online_test.manage",
  handler: (input, ctx) => listTests(ctx, input),
});

export const onlineTestsGetQuery = defineQuery({
  name: "onlineTests.get",
  module: MODULE,
  schema: TestIdSchema,
  permission: "online_test.manage",
  handler: ({ id }, ctx) => getTest(ctx, id),
});

export const onlineTestsMineQuery = defineQuery({
  name: "onlineTests.mine",
  module: MODULE,
  schema: NoInputSchema,
  permission: "online_test.take",
  handler: (_input, ctx) => myTests(ctx),
});

export const onlineTestsAttemptQuery = defineQuery({
  name: "onlineTests.attempt",
  module: MODULE,
  schema: AttemptIdSchema,
  permission: "online_test.take",
  handler: ({ attemptId }, ctx) => getAttemptPaper(ctx, attemptId),
});

export const onlineTestsResultQuery = defineQuery({
  name: "onlineTests.result",
  module: MODULE,
  schema: AttemptIdSchema,
  permission: "exam.result.read",
  handler: ({ attemptId }, ctx) => testResult(ctx, attemptId),
});

export const onlineTestsMarkingQueueQuery = defineQuery({
  name: "onlineTests.markingQueue",
  module: MODULE,
  schema: TestIdRefSchema,
  permission: "online_test.mark",
  handler: ({ testId }, ctx) => markingQueue(ctx, testId),
});

export const onlineTestsAnalyticsQuery = defineQuery({
  name: "onlineTests.analytics",
  module: MODULE,
  schema: TestIdRefSchema,
  permission: "online_test.mark",
  handler: ({ testId }, ctx) => testAnalytics(ctx, testId),
});
