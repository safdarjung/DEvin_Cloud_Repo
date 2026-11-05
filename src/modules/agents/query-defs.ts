// M22-T9 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/agents.<fn> (mirrors src/modules/core/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { agentDefinitions, agentRunDetail, agentRuns } from "./queries";
import { AgentDefinitionsQuerySchema, AgentRunDetailSchema, AgentRunsQuerySchema } from "./schemas";

export const agentDefinitionsQuery = defineQuery({
  name: "agents.definitions",
  module: "agents",
  schema: AgentDefinitionsQuerySchema,
  permission: "agent.run",
  handler: (_input, ctx) => agentDefinitions(ctx),
});

export const agentRunsQuery = defineQuery({
  name: "agents.runs",
  module: "agents",
  schema: AgentRunsQuerySchema,
  permission: "agent.run",
  handler: (input, ctx) => agentRuns(ctx, input),
});

export const agentRunDetailQuery = defineQuery({
  name: "agents.runDetail",
  module: "agents",
  schema: AgentRunDetailSchema,
  permission: "agent.run",
  handler: (input, ctx) => agentRunDetail(ctx, input),
});
