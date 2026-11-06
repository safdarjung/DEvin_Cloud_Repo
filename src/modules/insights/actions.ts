"use server";

// M19-T16 — insight.review / insight.action / insight.resolve /
// insight.dismiss (M19-tasks.md Task 16 rulings: State machine, Names).
// Style mirrors src/modules/people/leave.actions.ts (throwMapped helper,
// thin RPC wrapper). No TS audit: decide_insight / record_insight_action
// (built in T3) audit themselves.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import {
  CloseInsightSchema,
  RecordInsightActionSchema,
  ReviewInsightSchema,
  type CloseInsightInput,
  type RecordInsightActionInput,
  type ReviewInsightInput,
} from "@/modules/insights/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function decideInsight(
  _ctx: TenantContext,
  insightId: string,
  action: "resolve" | "dismiss",
  note: string,
): Promise<{ id: string; status: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_insight", {
    p_insight_id: insightId,
    p_action: action,
    p_note: note,
  });
  if (error) throwMapped(error);
  const row = data as { id: string; status: string };
  return { id: row.id, status: row.status };
}

export const reviewInsight = defineAction({
  name: "insight.review",
  module: "insights",
  schema: ReviewInsightSchema,
  permission: "insight.review",
  handler: async ({ insightId, reviewerId }: ReviewInsightInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decide_insight", {
      p_insight_id: insightId,
      p_action: "review",
      ...(reviewerId !== undefined ? { p_reviewer_id: reviewerId } : {}),
    });
    if (error) throwMapped(error);
    const row = data as { id: string; status: string };
    return { id: row.id, status: row.status };
  },
});

export const recordInsightAction = defineAction({
  name: "insight.action",
  module: "insights",
  schema: RecordInsightActionSchema,
  permission: "insight.review",
  handler: async ({
    insightId,
    supersedesId,
    action,
    owner,
    rationale,
    expectedOutcome,
    status,
    actualOutcome,
  }: RecordInsightActionInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_insight_action", {
      p_insight_id: insightId,
      p_action: action,
      p_owner: owner,
      p_rationale: rationale,
      p_expected_outcome: expectedOutcome,
      p_status: status,
      ...(actualOutcome !== undefined ? { p_actual_outcome: actualOutcome } : {}),
      ...(supersedesId !== undefined ? { p_supersedes_id: supersedesId } : {}),
    });
    if (error) throwMapped(error);
    const row = data as { id: string; insight_id: string; status: string };
    return { id: row.id, insightId: row.insight_id, status: row.status };
  },
});

export const resolveInsight = defineAction({
  name: "insight.resolve",
  module: "insights",
  schema: CloseInsightSchema,
  permission: "insight.review",
  handler: async ({ insightId, note }: CloseInsightInput, ctx) => decideInsight(ctx, insightId, "resolve", note),
});

export const dismissInsight = defineAction({
  name: "insight.dismiss",
  module: "insights",
  schema: CloseInsightSchema,
  permission: "insight.review",
  handler: async ({ insightId, note }: CloseInsightInput, ctx) => decideInsight(ctx, insightId, "dismiss", note),
});
