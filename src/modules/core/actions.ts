"use server";

// D30/D33 (12-decision-log.md) — the entitlements toggle. Owners/
// principals/admins hold `institution.settings.manage`; this is the only
// write path for `institutions.settings.features`. D33 generalized this
// from a single hardcoded `teacher_ai_agent` setter to any closed
// `FeatureKey` — the plan's own §7 suggestion to move toggling to
// `is_platform_admin` only was explicitly NOT taken (owner ruling,
// 2026-10-30): authority stays exactly where D30 put it.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { FEATURE_CATALOG, type FeatureKey } from "@/lib/auth/entitlements";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";

const FEATURE_KEYS = Object.keys(FEATURE_CATALOG) as [FeatureKey, ...FeatureKey[]];

export const setFeatureEnabled = defineAction({
  name: "core.feature.set",
  schema: z.object({ key: z.enum(FEATURE_KEYS), enabled: z.boolean() }),
  permission: "institution.settings.manage",
  handler: async ({ key, enabled }, ctx) => {
    const existingFeatures = ctx.institution.settings.features;
    const features = {
      ...(typeof existingFeatures === "object" && existingFeatures !== null ? existingFeatures : {}),
      [key]: enabled,
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
      action: "core.feature.set",
      entityType: "institution",
      entityId: ctx.institution.id,
      after: { [key]: enabled },
    });

    revalidatePath(`/${ctx.institution.slug}/ai`);
    return { key, enabled };
  },
});
