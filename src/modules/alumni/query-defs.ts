// Read-only wrappers exposed at /api/v1/query/alumni.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { AlumniCountsSchema, AlumniListSchema } from "./schemas";
import { alumniFacets, listAlumni } from "./queries";

/** Alumni directory (names + contact details; local-only for the AI agent). */
export const alumniListQuery = defineQuery({
  name: "alumni.list",
  module: "alumni",
  schema: AlumniListSchema,
  permission: "alumni.read",
  handler: (input, ctx) => listAlumni(ctx, input),
});

/** Alumni count per batch year and city list. Name-free aggregate. */
export const alumniCountsQuery = defineQuery({
  name: "alumni.counts",
  module: "alumni",
  schema: AlumniCountsSchema,
  permission: "alumni.read",
  handler: (_input, ctx) => alumniFacets(ctx),
});
