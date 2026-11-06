"use server";

// M20-T10 — mastery.intervention.update (06 §M20 Task 10). Thin RLS update
// over insight_actions' intervention columns; the state machine (edges,
// closed lock, steps shape) is enforced by app.guard_intervention (migration
// 0093 part 3, T6) via `code:invalid_state`/`code:validation_failed`,
// mirroring exam.paper.setUnits's throwMapped pattern rather than
// re-checking here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TablesUpdate } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { UpdateInterventionSchema, type UpdateInterventionInput } from "@/modules/mastery/schemas";

export const updateIntervention = defineAction({
  name: "mastery.intervention.update",
  module: "mastery",
  schema: UpdateInterventionSchema,
  permission: "mastery.review",
  handler: async (input: UpdateInterventionInput, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readError } = await supabase
      .from("insight_actions")
      .select("id, intervention_status")
      .eq("id", input.id)
      .eq("kind", "intervention")
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) {
      const mapped = mapSqlError(readError);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }
    if (!current) throw new AppError("not_found", "Intervention plan not found.");

    const patch: TablesUpdate<"insight_actions"> = {};
    if (input.goal !== undefined) patch.goal = input.goal;
    if (input.steps !== undefined) patch.steps = input.steps;
    if (input.reviewDate !== undefined) patch.review_date = input.reviewDate;
    if (input.status !== undefined) patch.intervention_status = input.status;

    const { data, error } = await supabase
      .from("insight_actions")
      .update(patch)
      .eq("id", input.id)
      .eq("kind", "intervention")
      .eq("institution_id", ctx.institution.id)
      .select("id, intervention_status")
      .maybeSingle();
    if (error) {
      const mapped = mapSqlError(error);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }
    if (!data) throw new AppError("not_found", "Intervention plan not found.");

    await audit(ctx, {
      action: "mastery.intervention.updated",
      entityType: "insight_action",
      entityId: input.id,
      metadata: { id: input.id, from: current.intervention_status, to: data.intervention_status },
    });

    return { id: data.id as string, status: data.intervention_status as string };
  },
});
