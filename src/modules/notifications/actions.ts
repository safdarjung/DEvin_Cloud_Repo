"use server";

// T-038 — 07 §2 `notification.read`. `markRead` may only touch the caller's
// own rows: `notifications_update` RLS (0003) already enforces
// `recipient_user_id = current_user` on both USING and WITH CHECK, and the
// `restrict_notification_update` trigger blocks changing anything but
// `read_at` — the explicit filter below is defense in depth on top of both.
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { MarkNotificationReadSchema } from "./schemas";

export const markRead = defineAction({
  name: "notification.read",
  module: "notifications",
  schema: MarkNotificationReadSchema,
  permission: "notification.read",
  handler: async ({ notificationId }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .eq("recipient_user_id", ctx.user.id)
      .is("read_at", null) // keep the first-read time on a repeat click
      .select("id")
      .maybeSingle();

    if (error) {
      const mapped = mapSqlError(error);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }
    if (!data) {
      // Nothing updated: either already read (ok) or not this user's notification (not_found).
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("id", notificationId)
        .eq("recipient_user_id", ctx.user.id)
        .maybeSingle();
      if (!existing) throw new AppError("not_found", "Notification not found.");
      return { id: existing.id };
    }

    revalidatePath(`/${ctx.institution.slug}/notifications`);
    return { id: data.id };
  },
});
