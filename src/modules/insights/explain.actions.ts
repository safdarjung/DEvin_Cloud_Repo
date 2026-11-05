"use server";

// M19-T17 — insight.explain (04 §5 "AI gateway", rulings "AI boundary").
// Detection/severity/confidence/status stay deterministic (D43); the
// gateway writes only an `explanation`, saved through the
// `set_insight_explanation` definer (migration 0092), never `status`.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { hasPermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { runStructured } from "@/lib/ai/gateway";
import { buildInsightExplainPrompt, INSIGHT_EXPLAIN_INSTRUCTIONS, toExplainInput } from "@/modules/insights/explain";
import { InsightExplanationSchema, InsightIdSchema, type InsightIdInput } from "@/modules/insights/schemas";

const OPEN_STATUSES = new Set(["new", "reviewing", "actioned"]);

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const explainInsight = defineAction({
  name: "insight.explain",
  module: "insights",
  schema: InsightIdSchema,
  permission: "insight.read",
  handler: async ({ insightId }: InsightIdInput, ctx) => {
    // Narrower than the action's own `insight.read` gate: 07 §2 gives
    // accountant/exam_controller `insight.read` but not `ai.generate`.
    if (!hasPermission(ctx, "ai.generate")) {
      throw new AppError("forbidden", "You do not have permission to use AI features.");
    }

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("insights")
      .select(
        "status, domain, kind, severity, title, pattern, evidence, date_from, date_to, confidence, recommended_actions, entity_type",
      )
      .eq("id", insightId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    // RLS already scopes this to rows the caller may see — missing-or-not-visible
    // never distinguishes "doesn't exist" from "exists in another section" (06 §1.1).
    if (!row) throw new AppError("not_found", "Insight not found.");
    if (!OPEN_STATUSES.has(row.status)) {
      throw new AppError("invalid_state", `Insight status "${row.status}" cannot be explained.`);
    }

    const result = await runStructured({
      ctx,
      feature: "insight_explain",
      schema: InsightExplanationSchema,
      instructions: INSIGHT_EXPLAIN_INSTRUCTIONS,
      prompt: buildInsightExplainPrompt(toExplainInput(row)),
      maxOutputTokens: 1024,
    });
    if (!result.ok) {
      throw new AppError(result.error.code, result.error.message, result.error.fieldErrors);
    }

    const { error: rpcError } = await supabase.rpc("set_insight_explanation", {
      p_insight_id: insightId,
      p_explanation: result.data.data,
      p_provider: result.data.provider,
      p_model: result.data.model,
    });
    if (rpcError) throwMapped(rpcError);

    return {
      insightId,
      explanation: result.data.data,
      provider: result.data.provider,
      model: result.data.model,
      fallback: result.data.fallback,
    };
  },
});
