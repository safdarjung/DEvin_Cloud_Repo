// M23-T17 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/workflows.<fn> (mirrors src/modules/agents/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { workflowList, workflowRuns } from "./queries";
import { WorkflowListSchema, WorkflowRunsSchema } from "./schemas";

export const workflowListQuery = defineQuery({
  name: "workflows.list",
  module: "workflows",
  schema: WorkflowListSchema,
  permission: "workflow.read",
  handler: (input, ctx) => workflowList(ctx, input),
});

export const workflowRunsQuery = defineQuery({
  name: "workflows.runs",
  module: "workflows",
  schema: WorkflowRunsSchema,
  permission: "workflow.read",
  handler: (input, ctx) => workflowRuns(ctx, input),
});
