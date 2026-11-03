"use server";

// M06-T5 — announcement.create / announcement.publish /
// notification.preferences.set (06 M06-tasks.md rulings; migration 0068).
// Mirrors src/modules/documents/actions.ts (defineAction, throwMapped,
// snake_case audit strings, ids/counts-only audit). publish_announcement
// is a security-definer RPC that already writes its own audit row
// (app.audit inside 0068) — no second audit() call here, same shape as
// website.page.publish / exam.result.publish.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  CreateAnnouncementSchema,
  PublishAnnouncementSchema,
  SetNotificationPreferenceSchema,
  type CreateAnnouncementInput,
  type PublishAnnouncementInput,
  type SetNotificationPreferenceInput,
} from "@/modules/notifications/announcements.schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const createAnnouncement = defineAction({
  name: "announcement.create",
  module: "announcements",
  schema: CreateAnnouncementSchema,
  permission: "announcement.manage",
  handler: async (input: CreateAnnouncementInput, ctx) => {
    const supabase = await createClient();

    const { data: announcement, error: announcementError } = await supabase
      .from("announcements")
      .insert({
        institution_id: ctx.institution.id,
        title: input.title,
        body: input.body,
        ...(input.category ? { category: input.category } : {}),
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (announcementError) throwMapped(announcementError);

    const audienceRows = input.audiences.map((a) => ({
      announcement_id: announcement.id,
      institution_id: ctx.institution.id,
      audience_type: a.type,
      role: a.type === "role" ? a.role : null,
      grade_id: a.type === "grade" ? a.gradeId : null,
      class_section_id: a.type === "section" ? a.classSectionId : null,
    }));
    // The draft row above already exists if this fails — that's fine, it's
    // still a draft the caller can inspect/retry audiences for (06 brief).
    const { error: audiencesError } = await supabase.from("announcement_audiences").insert(audienceRows);
    if (audiencesError) {
      // RLS rejects a grade/section that isn't this school's — a caller error, not `internal`.
      if (audiencesError.code === "42501") {
        throw new AppError("validation_failed", "Audience target not found in this school.", { audiences: ["Unknown grade or section."] });
      }
      throwMapped(audiencesError);
    }

    await audit(ctx, {
      action: "announcement.created",
      entityType: "announcement",
      entityId: announcement.id,
      after: { audienceCount: audienceRows.length },
    });

    return { announcementId: announcement.id as string };
  },
});

export const publishAnnouncement = defineAction({
  name: "announcement.publish",
  module: "announcements",
  schema: PublishAnnouncementSchema,
  permission: "announcement.manage",
  handler: async (input: PublishAnnouncementInput) => {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("publish_announcement", {
      p_announcement_id: input.announcementId,
    });
    if (error) throwMapped(error);

    return { announcementId: data.id as string, status: data.status as "draft" | "published" };
  },
});

export const setNotificationPreference = defineAction({
  name: "notification.preferences.set",
  module: "notifications",
  schema: SetNotificationPreferenceSchema,
  permission: "notification.read",
  handler: async (input: SetNotificationPreferenceInput, ctx) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: ctx.user.id,
          institution_id: ctx.institution.id,
          category: input.category,
          channel: input.channel,
          enabled: input.enabled,
        },
        { onConflict: "user_id,institution_id,category,channel" },
      )
      .select("category, channel, enabled")
      .single();
    if (error) throwMapped(error);

    await audit(ctx, {
      action: "notification.preference_set",
      entityType: "notification_preference",
      entityId: null,
      after: { category: data.category, channel: data.channel, enabled: data.enabled },
    });

    return { category: data.category as string, channel: data.channel as string, enabled: data.enabled as boolean };
  },
});
