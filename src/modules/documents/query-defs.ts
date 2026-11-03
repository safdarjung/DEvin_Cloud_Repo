// M05-T4 — read-only wrapper over ./queries.ts, exposed at
// /api/v1/query/documents.listForEntity (query-def style mirrors
// src/modules/imports/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { ListForEntitySchema } from "./schemas";
import { listDocumentsForEntity } from "./queries";

export const listDocumentsForEntityQuery = defineQuery({
  name: "documents.listForEntity",
  module: "core",
  schema: ListForEntitySchema,
  permission: "document.read",
  handler: (input, ctx) => listDocumentsForEntity(ctx, input.entityType, input.entityId),
});
