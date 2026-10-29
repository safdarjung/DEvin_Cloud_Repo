import "server-only";
// T-038 — notification reads (06 §W5, 07 §2). Always the signed-in user's
// RLS client: `notifications_select` (0003) already scopes rows to
// `recipient_user_id = current_user` (class O, C-30) and
// `delivery_attempts_select` scopes to owner/principal/admin/admissions
// (C-31, phone numbers are confidential) — the explicit filters below are
// defense in depth on top of that, not a replacement for it.
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

export interface NotificationSummary {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export async function listMyNotifications(ctx: TenantContext, limit = 50): Promise<NotificationSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, read_at, created_at")
    .eq("recipient_user_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function unreadCount(ctx: TenantContext): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", ctx.user.id)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export interface DeliveryLogRow {
  id: string;
  notificationId: string;
  channel: "in_app" | "sms" | "email";
  status: string;
  renderedBody: string;
  attemptedAt: string;
  notificationType: string;
}

/**
 * 07 §2.2 `notification.log.read` (owner/principal/admin/admissions) — SMS
 * and email rows always carry `status = 'simulated'` (C-31): never a real
 * provider reference, since no provider is ever called. Never selects
 * `to_address` or `provider`/`provider_ref` here — the log view shows the
 * rendered message, not the destination (06 §3 "no provider refs").
 */
export async function listDeliveryLog(ctx: TenantContext, limit = 100): Promise<DeliveryLogRow[]> {
  requirePermission(ctx, "notification.log.read");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_attempts")
    .select("id, notification_id, channel, status, rendered_body, attempted_at, notifications(type)")
    .eq("institution_id", ctx.institution.id)
    .order("attempted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const notification = row.notifications as { type: string } | { type: string }[] | null;
    const notificationType = Array.isArray(notification) ? notification[0]?.type : notification?.type;
    return {
      id: row.id,
      notificationId: row.notification_id,
      channel: row.channel as DeliveryLogRow["channel"],
      status: row.status,
      renderedBody: row.rendered_body,
      attemptedAt: row.attempted_at,
      notificationType: notificationType ?? "unknown",
    };
  });
}
