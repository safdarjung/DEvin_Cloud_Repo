// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/resources.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { PortalResourcesSchema, ResourceBrowseSchema, ResourceSummarySchema } from "./schemas";
import { browseResources, portalResources, resourceSummary } from "./queries";

/** Resources the caller may read, optionally one subject. Holds creator-owned drafts: local-only for the AI agent. */
export const resourcesBrowseQuery = defineQuery({
  name: "resources.browse",
  module: "resources",
  schema: ResourceBrowseSchema,
  permission: "resource.read",
  handler: (input, ctx) => browseResources(ctx, input),
});

/** Published resources for one child's section (own child / self). */
export const resourcesForStudentQuery = defineQuery({
  name: "resources.forStudent",
  module: "resources",
  schema: PortalResourcesSchema,
  permission: "resource.read",
  handler: (input, ctx) => portalResources(ctx, input.studentId),
});

/** Name-free aggregate: published resource counts by subject. */
export const resourcesSummaryQuery = defineQuery({
  name: "resources.summary",
  module: "resources",
  schema: ResourceSummarySchema,
  permission: "resource.read",
  handler: (_input, ctx) => resourceSummary(ctx),
});
