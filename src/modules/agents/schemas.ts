// Agent action schemas (relative .ts imports only; no @/ aliases).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common";
import { AGENT_SLUGS } from "./catalog";

export const RunAgentSchema = z
  .object({
    slug: z.enum(AGENT_SLUGS),
    task: z.string().trim().min(1).max(500),
  })
  .strict();

export type RunAgentInput = z.infer<typeof RunAgentSchema>;

export const DecideAgentRunSchema = z
  .object({
    runId: uuid,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type DecideAgentRunInput = z.infer<typeof DecideAgentRunSchema>;

export const SetAgentEnabledSchema = z
  .object({
    slug: z.enum(AGENT_SLUGS),
    enabled: z.boolean(),
  })
  .strict();

export type SetAgentEnabledInput = z.infer<typeof SetAgentEnabledSchema>;

export const AgentDefinitionsQuerySchema = z.object({}).strict();

export type AgentDefinitionsQueryInput = z.infer<typeof AgentDefinitionsQuerySchema>;

export const AgentRunsQuerySchema = z
  .object({
    slug: z.enum(AGENT_SLUGS).optional(),
    status: z.enum(["running", "done", "failed", "awaiting_approval", "rejected", "queued"]).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export type AgentRunsQueryInput = z.infer<typeof AgentRunsQuerySchema>;

export const AgentRunDetailSchema = z
  .object({
    runId: uuid,
  })
  .strict();

export type AgentRunDetailInput = z.infer<typeof AgentRunDetailSchema>;
