"use server";

// Orb task bridge — the proposal actions the approval card calls by name
// through /api/v1/actions (design §4, §7). Permission ai.chat (every role,
// students included, so no ai.study twin is needed); the target action's own
// permission, module, Zod and RLS gates run again inside approve. The logic
// lives in ./proposals (loaded on demand: state.ts imports all-actions, which
// imports this file).
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { uuid } from "@/lib/schemas/common";
import type { TaskProposalOutput } from "./types";

const Values = z.record(z.string().max(80), z.unknown());
// `replaces`: a pending card of the same task to close in favour of this one (a section picked on an empty register).
const StartSchema = z.object({ action: z.string().min(1).max(120), values: Values.optional(), replaces: uuid.optional() }).strict();
const ApproveSchema = z.object({ proposalId: uuid, values: Values }).strict();
const IdSchema = z.object({ proposalId: uuid }).strict();

const core = () => import("./proposals");

/** Opens a card with no model call (a task clicked in the orb, or an undo); same sanitising as propose_task. */
export const startProposal = defineAction({
  name: "ai.proposal.start",
  module: "core",
  schema: StartSchema,
  permission: "ai.chat",
  handler: async (input, ctx): Promise<TaskProposalOutput> =>
    (await core()).createProposal(ctx, { action: input.action, values: input.values ?? {}, replaces: input.replaces, source: "person" }),
});

export const approveProposal = defineAction({
  name: "ai.proposal.approve",
  module: "core",
  schema: ApproveSchema,
  permission: "ai.chat",
  handler: async (input, ctx) => (await core()).approveProposal(ctx, input.proposalId, input.values),
});

export const discardProposal = defineAction({
  name: "ai.proposal.discard",
  module: "core",
  schema: IdSchema,
  permission: "ai.chat",
  handler: async (input, ctx) => (await core()).discardProposal(ctx, input.proposalId),
});

export const openedProposal = defineAction({
  name: "ai.proposal.opened",
  module: "core",
  schema: IdSchema,
  permission: "ai.chat",
  handler: async (input, ctx) => (await core()).openedProposal(ctx, input.proposalId),
});
