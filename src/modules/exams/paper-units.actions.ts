"use server";

// M20-T7 — exam.paper.setUnits (06 §M20 Task 7). Thin RLS update over
// exam_papers.unit_ids; the mapping rules (same subject/grade, no dup, this
// institution) are enforced by the BEFORE INSERT OR UPDATE trigger
// app.validate_exam_paper_units() (migration 0093 part 1, T4) via
// `code:validation_failed`, mirroring the module's throwMapped pattern
// (schedule-conflicts.ts) rather than re-checking here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { SetPaperUnitsSchema, type SetPaperUnitsInput } from "@/modules/mastery/schemas";

export const setPaperUnits = defineAction({
  name: "exam.paper.setUnits",
  module: "mastery",
  schema: SetPaperUnitsSchema,
  permission: "exam.manage",
  handler: async (input: SetPaperUnitsInput, ctx) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("exam_papers")
      .update({ unit_ids: input.unitIds })
      .eq("id", input.paperId)
      .eq("institution_id", ctx.institution.id)
      .select("id");
    if (error) {
      const mapped = mapSqlError(error);
      if (!mapped.ok && mapped.error.code === "validation_failed") {
        throw new AppError("validation_failed", mapped.error.message, {
          unitIds: ["Units must belong to this paper's subject and grade."],
        });
      }
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }
    if ((data ?? []).length === 0) throw new AppError("not_found", "Paper not found.");

    await audit(ctx, {
      action: "exam.paper.units_set",
      entityType: "exam_paper",
      entityId: input.paperId,
      metadata: { paperId: input.paperId, unitCount: input.unitIds.length },
    });

    return { paperId: input.paperId, unitIds: input.unitIds };
  },
});
