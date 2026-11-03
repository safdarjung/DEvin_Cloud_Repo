// M11-T8 — read-only wrapper over ./queries.ts, exposed at
// /api/v1/query/questionBank.list (mirrors timetable/query-defs.ts).
// Owner module: question_bank (M11-tasks.md rulings). permission
// question.manage: RLS (0073) does the real scoping (teacher sees only
// their taught (grade, subject) pairs; owner/principal/exam_controller see
// all; no policy for guardian/student/admin, caught earlier by the
// permission gate).
import { defineQuery } from "@/lib/actions/define-query";
import { QuestionListSchema } from "@/modules/question-bank/schemas";
import { listQuestions } from "@/modules/question-bank/queries";

export const questionBankListQuery = defineQuery({
  name: "questionBank.list",
  module: "question_bank",
  schema: QuestionListSchema,
  permission: "question.manage",
  handler: (input, ctx) => listQuestions(ctx, input),
});
