"use server";

// X01-T8 — diary.entry.post / diary.entry.delete / diary.acknowledge
// (X01-tasks.md Task 8 rulings; migration 0085 part 2's diary_entries +
// diary_acknowledgements, built in T5). Style mirrors
// src/modules/people/leave.actions.ts (throwMapped/isRlsViolation helpers)
// and src/modules/notifications/announcements.actions.ts (42501 mapping).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  DiaryAcknowledgeSchema,
  DiaryDeleteSchema,
  DiaryPostSchema,
  type DiaryAcknowledgeInput,
  type DiaryDeleteInput,
  type DiaryPostInput,
} from "@/modules/diary/schemas";

const POSTGRES_RLS_VIOLATION = "42501";
const POSTGRES_UNIQUE_VIOLATION = "23505";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

export const postDiaryEntry = defineAction({
  name: "diary.entry.post",
  module: "diary",
  schema: DiaryPostSchema,
  permission: "diary.write",
  handler: async ({ classSectionId, subjectId, entryDate, body, dueDate, requiresAck }: DiaryPostInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("diary_entries")
      .insert({
        institution_id: ctx.institution.id,
        class_section_id: classSectionId,
        subject_id: subjectId ?? null,
        entry_date: entryDate,
        body,
        due_date: dueDate ?? null,
        requires_ack: requiresAck,
        created_by: ctx.user.id,
      })
      .select("id, class_section_id")
      .single();
    if (error) {
      if (isRlsViolation(error)) {
        throw new AppError("forbidden", "You do not teach this section.");
      }
      throwMapped(error);
    }

    await audit(ctx, {
      action: "diary.entry.posted",
      entityType: "diary_entry",
      entityId: data.id as string,
      after: { classSectionId: data.class_section_id },
    });

    return { id: data.id as string };
  },
});

export const deleteDiaryEntry = defineAction({
  name: "diary.entry.delete",
  module: "diary",
  schema: DiaryDeleteSchema,
  permission: "diary.write",
  handler: async ({ entryId }: DiaryDeleteInput, ctx) => {
    const supabase = await createClient();

    // Visibility (SELECT policy) and deletability (DELETE policy) are
    // different RLS checks on this table (rulings §ErrorCode mapping):
    // invisible -> not_found, visible-but-not-author/admin -> forbidden.
    const { data: visible, error: selectError } = await supabase
      .from("diary_entries")
      .select("id, class_section_id")
      .eq("id", entryId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (selectError) throwMapped(selectError);
    if (!visible) throw new AppError("not_found", "Diary entry not found.");

    const { data: deleted, error: deleteError } = await supabase
      .from("diary_entries")
      .delete()
      .eq("id", entryId)
      .select("id");
    if (deleteError) throwMapped(deleteError);
    if (!deleted || deleted.length === 0) {
      throw new AppError("forbidden", "You do not have permission to perform this action.");
    }

    await audit(ctx, {
      action: "diary.entry.deleted",
      entityType: "diary_entry",
      entityId: entryId,
      after: { classSectionId: visible.class_section_id },
    });

    return { id: entryId };
  },
});

export const acknowledgeDiaryEntry = defineAction({
  name: "diary.acknowledge",
  module: "diary",
  schema: DiaryAcknowledgeSchema,
  permission: "assignment.read",
  handler: async ({ entryId, studentId }: DiaryAcknowledgeInput, ctx) => {
    const supabase = await createClient();

    const { data: entry, error: selectError } = await supabase
      .from("diary_entries")
      .select("id, requires_ack")
      .eq("id", entryId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (selectError) throwMapped(selectError);
    if (!entry) throw new AppError("not_found", "Diary entry not found.");
    if (!entry.requires_ack) {
      throw new AppError("invalid_state", "This entry does not require acknowledgement.");
    }

    const { error: insertError } = await supabase.from("diary_acknowledgements").insert({
      institution_id: ctx.institution.id,
      entry_id: entryId,
      student_id: studentId,
      acknowledged_by: ctx.user.id,
    });
    if (insertError) {
      // Idempotent ack (rulings §ErrorCode mapping): a repeat ack is success,
      // not an error — the unique (entry_id, student_id) constraint caught it.
      if (isUniqueViolation(insertError)) {
        return { entryId, studentId, acknowledged: true as const };
      }
      if (isRlsViolation(insertError)) {
        throw new AppError("forbidden", "You do not have permission to perform this action.");
      }
      throwMapped(insertError);
    }

    return { entryId, studentId, acknowledged: true as const };
  },
});
