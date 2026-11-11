"use server";

// Study with AI on a chosen scope (0140 item 8): a scoped tutor chat is a
// study_items 'chat' row (0049: own rows only, never a guardian) with the
// scope ids it was opened on. Opening re-checks every id under the student's
// RLS (resolveScope drops or refuses anything not theirs); later turns rebuild
// the context from the database, never from the stored text. Renaming reuses
// ai.study.item.update. Time studied is logged per unit for the picker.
import { defineAction } from "@/lib/actions/define-action";
import { AppError } from "@/lib/actions/result";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { throwMapped } from "@/modules/study/material-write";
import { LogScopeTimeSchema, OpenScopeSchema, SaveScopeMessagesSchema } from "@/modules/study/schemas";
import { getScopeSession, resolveScope } from "@/modules/study/scope.queries";

export const openStudyScope = defineAction({
  name: "study.scope.open",
  module: "ai_student",
  schema: OpenScopeSchema,
  permission: "ai.study",
  handler: async ({ scope, title }, ctx) => {
    if (!ctx.membership.studentId) throw new AppError("forbidden", "Study with AI is for students.");
    const { context } = await resolveScope(ctx, scope);
    // Store only what survived the check, so a later turn never re-reads a dropped id.
    const kept = {
      subjectIds: context.subjectIds,
      ...(context.textbookIds.length ? { textbookIds: context.textbookIds } : {}),
      ...(context.chapters.length ? { chapters: context.chapters } : {}),
      ...(context.unitIds.length ? { unitIds: context.unitIds } : {}),
      ...(context.fileIds.length ? { fileIds: context.fileIds } : {}),
      ...(scope.goal ? { goal: scope.goal } : {}),
    };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_items")
      .insert({ institution_id: ctx.institution.id, user_id: ctx.user.id, kind: "chat", title: title ?? context.title, content: { messages: [] }, scope: kept as Json })
      .select("id")
      .single();
    if (error) throwMapped(error);
    return { id: data.id as string };
  },
});

export const saveStudyScopeMessages = defineAction({
  name: "study.scope.saveMessages",
  module: "ai_student",
  schema: SaveScopeMessagesSchema,
  permission: "ai.study",
  handler: async ({ itemId, messages }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_items")
      .update({ content: { messages } as unknown as NonNullable<Json> })
      .eq("id", itemId)
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .eq("kind", "chat")
      .not("scope", "is", null)
      .select("id");
    if (error) throwMapped(error);
    if (!data?.length) throw new AppError("not_found", "That study session was not found.");
    return { id: itemId };
  },
});

export const logStudyScopeTime = defineAction({
  name: "study.scope.logTime",
  module: "ai_student",
  schema: LogScopeTimeSchema,
  permission: "ai.study",
  handler: async ({ itemId, minutes }, ctx) => {
    const studentId = ctx.membership.studentId;
    if (!studentId) throw new AppError("forbidden", "Study with AI is for students.");
    const session = await getScopeSession(ctx, itemId);
    if (!session) throw new AppError("not_found", "That study session was not found.");
    const { context } = await resolveScope(ctx, session.scope);
    // Time is split across the scope's units (at least a minute each) so per-unit progress adds up.
    const units = context.unitIds.length ? context.unitIds.slice(0, Math.max(1, minutes)) : [null];
    const each = Math.max(1, Math.floor(minutes / units.length));
    const supabase = await createClient();
    const { error } = await supabase.from("study_sessions").insert(
      units.map((unitId) => ({
        institution_id: ctx.institution.id,
        student_id: studentId,
        activity: "reading",
        minutes: each,
        subject_id: context.subjectIds.length === 1 ? context.subjectIds[0]! : null,
        curriculum_unit_id: unitId,
      })),
    );
    if (error) throwMapped(error);
    return { minutes: each * units.length };
  },
});
