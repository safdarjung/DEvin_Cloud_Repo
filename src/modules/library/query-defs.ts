// X03-T7 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/library.<fn> (mirrors src/modules/timetable/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { CatalogQuerySchema, MyLoansQuerySchema, OverdueQuerySchema } from "./schemas";
import { libraryCatalog, libraryMyLoans, libraryOverdue } from "./queries";

export const libraryCatalogQuery = defineQuery({
  name: "library.catalog",
  module: "library",
  schema: CatalogQuerySchema,
  permission: "library.manage",
  handler: (input, ctx) => libraryCatalog(ctx, input),
});

export const libraryOverdueQuery = defineQuery({
  name: "library.overdue",
  module: "library",
  schema: OverdueQuerySchema,
  permission: "library.manage",
  handler: (input, ctx) => libraryOverdue(ctx, input),
});

export const libraryMyLoansQuery = defineQuery({
  name: "library.myLoans",
  module: "library",
  schema: MyLoansQuerySchema,
  permission: "library.read",
  handler: (input, ctx) => libraryMyLoans(ctx, input),
});
