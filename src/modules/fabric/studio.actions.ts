"use server";

// F-UI-12 (live-fabric studio lane) — studio.request.submit/propose/decide.
// submitStudioRequest inserts directly (RLS 0107 scopes to leadership);
// proposeStudioRequest calls the AI gateway, then saves the result through
// propose_studio_request; decideStudioRequest is a thin RPC wrapper that
// re-checks owner/principal state server-side (06 §1.1, AI boundary rule 6
// — AI only drafts the proposal, a human approves/rejects it).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import {
  DecideStudioRequestSchema,
  StudioProposalSchema,
  StudioRequestIdSchema,
  SubmitStudioRequestSchema,
  type DecideStudioRequestInput,
  type StudioRequestIdInput,
  type SubmitStudioRequestInput,
} from "@/modules/fabric/studio.schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

const STUDIO_PROPOSAL_INSTRUCTIONS =
  "You turn a school's plain-language software request into a structured engineering proposal. " +
  "Pick the cheapest resolution that actually solves the problem: prefer existing_feature or configuration " +
  "over integration, combine_modules, new_module, or platform_change, in that order. Be concrete and specific " +
  "to the stated problem; never invent integrations or costs the request doesn't support.";

function buildProposalPrompt(request: {
  title: string;
  problem: string;
  desiredOutcome: string;
  context: Record<string, unknown>;
  terms: Record<string, unknown>;
}): string {
  return [
    `Title: ${request.title}`,
    `Problem: ${request.problem}`,
    `Desired outcome: ${request.desiredOutcome}`,
    `Context: ${JSON.stringify(request.context)}`,
    `Terms: ${JSON.stringify(request.terms)}`,
  ].join("\n");
}

export const submitStudioRequest = defineAction({
  name: "studio.request.submit",
  module: "core",
  schema: SubmitStudioRequestSchema,
  permission: "studio.request",
  handler: async (input: SubmitStudioRequestInput, ctx: TenantContext) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("studio_requests")
      .insert({
        institution_id: ctx.institution.id,
        // Forced to the real caller by the guard trigger (0107) either way;
        // supplied here only to satisfy the generated Insert type.
        created_by: ctx.user.id,
        title: input.title,
        problem: input.problem,
        desired_outcome: input.desiredOutcome,
        context: {
          userRoles: input.userRoles,
          existingSystems: input.existingSystems,
          integrations: input.integrations,
          constraints: input.constraints,
        },
        terms: {
          budgetRange: input.budgetRange,
          timeline: input.timeline,
          successCriteria: input.successCriteria,
        },
      })
      .select("id, status")
      .single();
    if (error) throwMapped(error);
    return { id: data.id as string, status: data.status as string };
  },
});

export const proposeStudioRequest = defineAction({
  name: "studio.request.propose",
  module: "core",
  schema: StudioRequestIdSchema,
  permission: "studio.request",
  handler: async ({ requestId }: StudioRequestIdInput, ctx: TenantContext) => {
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("studio_requests")
      .select("title, problem, desired_outcome, context, terms, status")
      .eq("id", requestId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!row) throw new AppError("not_found", "Studio request not found.");
    if (row.status !== "submitted") {
      throw new AppError("invalid_state", `Studio request status "${row.status}" cannot be proposed.`);
    }

    const result = await runStructured({
      ctx,
      feature: "studio_proposal",
      agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
      schema: StudioProposalSchema,
      instructions: STUDIO_PROPOSAL_INSTRUCTIONS,
      prompt: buildProposalPrompt({
        title: row.title,
        problem: row.problem,
        desiredOutcome: row.desired_outcome,
        context: (row.context as Record<string, unknown>) ?? {},
        terms: (row.terms as Record<string, unknown>) ?? {},
      }),
      maxOutputTokens: 1536,
    });
    if (!result.ok) {
      throw new AppError(result.error.code, result.error.message, result.error.fieldErrors);
    }

    const { data: updated, error: rpcError } = await supabase.rpc("propose_studio_request", {
      p_request_id: requestId,
      p_proposal: result.data.data,
    });
    if (rpcError) throwMapped(rpcError);

    return { id: requestId, status: (updated as { status: string }).status, proposal: result.data.data };
  },
});

export const decideStudioRequest = defineAction({
  name: "studio.request.decide",
  module: "core",
  schema: DecideStudioRequestSchema,
  permission: "studio.approve",
  handler: async ({ requestId, decision, note }: DecideStudioRequestInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decide_studio_request", {
      p_request_id: requestId,
      p_decision: decision,
      ...(note !== undefined ? { p_note: note } : {}),
    });
    if (error) throwMapped(error);
    const row = data as { id: string; status: string };
    return { id: row.id, status: row.status };
  },
});
