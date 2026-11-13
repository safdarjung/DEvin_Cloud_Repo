// Phase 3 — read-only wrappers over ./queries.ts at /api/v1/query/<name>.
// permission question.manage: RLS (0149) does the scoping (teacher: taught
// grade+subject; leadership: school-wide; students/guardians: no policy).
import { defineQuery } from "@/lib/actions/define-query";
import { AppError } from "@/lib/actions/result";
import { PaperIdSchema, PaperListSchema, TemplateListSchema, WhereUsedSchema } from "@/modules/question-papers/schemas";
import { getPaper, listPapers, listTemplates, listVersions, validatePaper, whereUsed } from "@/modules/question-papers/queries";

const MODULE = "question_bank" as const;

export const questionPapersListQuery = defineQuery({
  name: "questionPapers.list",
  module: MODULE,
  schema: PaperListSchema,
  permission: "question.manage",
  handler: (input, ctx) => listPapers(ctx, input),
});

export const questionPapersGetQuery = defineQuery({
  name: "questionPapers.get",
  module: MODULE,
  schema: PaperIdSchema,
  permission: "question.manage",
  handler: async ({ id }, ctx) => {
    const paper = await getPaper(ctx, id);
    if (!paper) throw new AppError("not_found", "Paper not found.");
    return paper;
  },
});

export const questionPapersValidateQuery = defineQuery({
  name: "questionPapers.validate",
  module: MODULE,
  schema: PaperIdSchema,
  permission: "question.manage",
  handler: ({ id }, ctx) => validatePaper(ctx, id),
});

export const questionPapersVersionsQuery = defineQuery({
  name: "questionPapers.versions",
  module: MODULE,
  schema: PaperIdSchema,
  permission: "question.manage",
  handler: ({ id }, ctx) => listVersions(ctx, id),
});

export const questionPapersTemplatesQuery = defineQuery({
  name: "questionPapers.templates",
  module: MODULE,
  schema: TemplateListSchema,
  permission: "question.manage",
  handler: (input, ctx) => listTemplates(ctx, input),
});

export const questionPapersWhereUsedQuery = defineQuery({
  name: "questionPapers.whereUsed",
  module: MODULE,
  schema: WhereUsedSchema,
  permission: "question.manage",
  handler: ({ questionId }, ctx) => whereUsed(ctx, questionId),
});
