// 0148 — /api/v1/query/content.search and content.extractionStatus. RLS
// (caller's client) scopes rows; academics.read is the floor every member
// role holds that may read textbooks.
import { defineQuery } from "@/lib/actions/define-query";
import { getExtractionStatus, searchContent } from "./queries";
import { ContentSearchSchema, ExtractionStatusSchema } from "./schemas";

export const contentSearchQuery = defineQuery({
  name: "content.search",
  module: "academic_structure",
  schema: ContentSearchSchema,
  permission: "academics.read",
  handler: (input, ctx) => searchContent(ctx, input),
});

export const contentExtractionStatusQuery = defineQuery({
  name: "content.extractionStatus",
  module: "academic_structure",
  schema: ExtractionStatusSchema,
  permission: "academics.read",
  handler: (input, ctx) => getExtractionStatus(ctx, input),
});
