// M04-T6 — read-only wrapper over ./queries.ts, exposed at
// /api/v1/query/imports.getBatch (query-def style mirrors
// src/modules/people/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { uuid } from "@/lib/schemas/common";
import { z } from "zod";
import { getImportBatch } from "./queries";

export const getImportBatchQuery = defineQuery({
  name: "imports.getBatch",
  module: "core",
  schema: z.object({ batchId: uuid }).strict(),
  permission: "data.import",
  handler: (input, ctx) => getImportBatch(ctx, input.batchId),
});
