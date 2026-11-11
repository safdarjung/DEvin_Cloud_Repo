// Agent action schemas (relative .ts imports only; no @/ aliases).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common";
import { AGENT_CATALOG, AGENT_SLUGS, CUSTOM_AGENT_SLUG_RE, MAX_CUSTOM_INSTRUCTIONS } from "./catalog";

// A catalog slug, or a custom agent's server-made `custom_<hex>` slug.
const agentSlug = z.union([z.enum(AGENT_SLUGS), z.string().regex(CUSTOM_AGENT_SLUG_RE)]);

export const RunAgentSchema = z
  .object({
    slug: agentSlug,
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
    slug: agentSlug,
    enabled: z.boolean(),
  })
  .strict();

export type SetAgentEnabledInput = z.infer<typeof SetAgentEnabledSchema>;

// Custom agents (0134). The subset check is the write-time half of "never
// exceeds its base"; `scopedSpec` re-applies it at every run (catalog.ts).
const customAgentFields = {
  name: z.string().trim().min(3).max(60),
  summary: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(MAX_CUSTOM_INSTRUCTIONS),
  examples: z.array(z.string().trim().min(1).max(90)).max(3),
  baseSlug: z.enum(AGENT_SLUGS),
  tools: z.array(z.string()).min(1).max(10),
  actions: z.array(z.string()).max(10),
};

type SubsetInput = { baseSlug: (typeof AGENT_SLUGS)[number]; tools: string[]; actions: string[] };

function refineSubset(input: SubsetInput, ctx: z.RefinementCtx): void {
  const base = AGENT_CATALOG[input.baseSlug];
  for (const key of ["tools", "actions"] as const) {
    const outside = input[key].filter((name) => !Object.hasOwn(base[key], name));
    if (outside.length > 0) {
      ctx.addIssue({ code: "custom", path: [key], message: `Not part of the ${base.name}: ${outside.join(", ")}` });
    }
  }
}

export const CreateCustomAgentSchema = z.object(customAgentFields).strict().superRefine(refineSubset);

export type CreateCustomAgentInput = z.infer<typeof CreateCustomAgentSchema>;

// `baseSlug` is fixed after create; the action only matches a row with this same base.
export const UpdateCustomAgentSchema = z
  .object({ id: uuid, ...customAgentFields })
  .strict()
  .superRefine(refineSubset);

export type UpdateCustomAgentInput = z.infer<typeof UpdateCustomAgentSchema>;

export const ArchiveCustomAgentSchema = z.object({ id: uuid }).strict();

export type ArchiveCustomAgentInput = z.infer<typeof ArchiveCustomAgentSchema>;

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
