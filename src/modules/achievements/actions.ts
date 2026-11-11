"use server";

// achievement.record / achievement.verify / achievement.void (migration 0128). Record is a plain
// RLS insert (teacher: taught students only); verify and void only through the definers, which
// write their own audit rows. Record is AI-draftable (§E); verify is never draftable.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  AchievementRecordSchema,
  AchievementVerifySchema,
  AchievementVoidSchema,
  type AchievementRecordInput,
  type AchievementVerifyInput,
  type AchievementVoidInput,
} from "./schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const recordAchievement = defineAction({
  name: "achievement.record",
  module: "achievements",
  schema: AchievementRecordSchema,
  permission: "achievement.write",
  handler: async (input: AchievementRecordInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("achievements")
      .insert({
        institution_id: ctx.institution.id,
        student_id: input.studentId,
        title: input.title,
        category: input.category,
        level: input.level,
        position: input.position ?? null,
        event_date: input.eventDate,
        description: input.description ?? null,
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "You can only record achievements for students you teach.");
      }
      throwMapped(error);
    }
    await audit(ctx, {
      action: "achievement.record",
      entityType: "achievements",
      entityId: data.id,
      after: { studentId: input.studentId, category: input.category, level: input.level },
    });
    return { id: data.id as string };
  },
});

export const verifyAchievement = defineAction({
  name: "achievement.verify",
  module: "achievements",
  schema: AchievementVerifySchema,
  permission: "achievement.verify",
  // The definer writes its own audit row (ids only).
  handler: async ({ achievementId }: AchievementVerifyInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("verify_achievement", { p_institution_id: ctx.institution.id, p_achievement_id: achievementId });
    if (error) throwMapped(error);
    return { id: data.id as string };
  },
});

export const voidAchievement = defineAction({
  name: "achievement.void",
  module: "achievements",
  schema: AchievementVoidSchema,
  permission: "achievement.write",
  handler: async ({ achievementId, reason }: AchievementVoidInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("void_achievement", { p_institution_id: ctx.institution.id, p_achievement_id: achievementId, p_reason: reason });
    if (error) throwMapped(error);
    return { id: data.id as string };
  },
});
