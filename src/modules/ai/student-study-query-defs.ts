// M02-T7 (controller ruling) — read-only wrappers for
// ./student-study.queries.ts, exposed at /api/v1/query/ai.<fn>. Same
// defineQuery shape as query-defs.ts; permission: ai.study — the student
// portal's only caller (07 §2.2: student-only, D32/GU-08).
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { getStudyItem, listStudyFolders, listStudyItems } from "./student-study.queries";

export const listStudyItemsQuery = defineQuery({
  name: "ai.listStudyItems",
  schema: z.object({ folder: z.string().optional(), search: z.string().optional() }).strict(),
  permission: "ai.study",
  handler: (input, ctx) => listStudyItems(ctx, input),
});

export const listStudyFoldersQuery = defineQuery({
  name: "ai.listStudyFolders",
  schema: z.object({}).strict(),
  permission: "ai.study",
  handler: (_input, ctx) => listStudyFolders(ctx),
});

export const getStudyItemQuery = defineQuery({
  name: "ai.getStudyItem",
  schema: z.object({ itemId: uuid }).strict(),
  permission: "ai.study",
  handler: (input, ctx) => getStudyItem(ctx, input.itemId),
});
