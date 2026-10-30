"use server";

// D30 (12-decision-log.md) — v1 entitlements toggle. Owners/principals/
// admins already hold `institution.settings.manage`; this is the only
// write path for `institutions.settings.features`, kept to the one real
// flag (`teacher_ai_agent`) rather than a generic "set any settings key"
// action, matching the ADR's deliberately narrow v1 scope.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";

export const setTeacherAgentEnabled = defineAction({
  name: "core.feature.teacher_ai_agent.set",
  schema: z.object({ enabled: z.boolean() }),
  permission: "institution.settings.manage",
  handler: async ({ enabled }, ctx) => {
    const existingFeatures = ctx.institution.settings.features;
    const features = {
      ...(typeof existingFeatures === "object" && existingFeatures !== null ? existingFeatures : {}),
      teacher_ai_agent: enabled,
    };

    // Only this sub-key is validated (same per-key pattern as
    // attendance/actions.ts's `attendanceStatusCodes`) — `settings` as a
    // whole may predate other keys this packet never touches (e.g. a bare
    // test fixture institution), so re-validating the full strict schema
    // here would wrongly block a narrow, unrelated patch.
    const parsedFeatures = InstitutionSettingsSchema.shape.features.safeParse(features);
    if (!parsedFeatures.success) {
      throw new AppError("validation_failed", "This institution's settings could not be updated safely.");
    }
    const settings = { ...ctx.institution.settings, features: parsedFeatures.data };

    const supabase = await createClient();
    const { error } = await supabase
      .from("institutions")
      .update({ settings })
      .eq("id", ctx.institution.id);
    if (error) {
      const mapped = mapSqlError(error);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }

    await audit(ctx, {
      action: "core.feature.teacher_ai_agent.set",
      entityType: "institution",
      entityId: ctx.institution.id,
      after: { teacher_ai_agent: enabled },
    });

    revalidatePath(`/${ctx.institution.slug}/ai`);
    return { enabled };
  },
});
