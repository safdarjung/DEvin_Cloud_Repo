// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/form.<fn>.
// form.responses is a flat array, so ?format=csv exports it via the shared CSV helper.
import { defineQuery } from "@/lib/actions/define-query";
import { FormIdSchema, FormListSchema, FormMineSchema } from "./schemas";
import { formList, formMine, formResponses, formResults } from "./queries";

export const formListQuery = defineQuery({
  name: "form.list",
  module: "forms",
  schema: FormListSchema,
  permission: "form.manage",
  handler: (_input, ctx) => formList(ctx),
});

export const formResultsQuery = defineQuery({
  name: "form.results",
  module: "forms",
  schema: FormIdSchema,
  permission: "form.manage",
  handler: (input, ctx) => formResults(ctx, input.formId),
});

export const formResponsesQuery = defineQuery({
  name: "form.responses",
  module: "forms",
  schema: FormIdSchema,
  permission: "form.manage",
  handler: (input, ctx) => formResponses(ctx, input.formId),
});

export const formMineQuery = defineQuery({
  name: "form.mine",
  module: "forms",
  schema: FormMineSchema,
  permission: "form.respond",
  handler: (_input, ctx) => formMine(ctx),
});
