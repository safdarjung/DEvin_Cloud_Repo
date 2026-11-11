// Features-18 #21 — fans out a safety alert. Payload: `{ alert_id }`
// (public.create_safety_alert, 0129, idempotency_key `safety_alert:<id>`).
// Lesson 11: message content comes from the alert row only (never the
// payload); recipients are re-resolved from current ACTIVE memberships with
// the same audience rule as the RLS (../../safety/recipients.ts); the alert's
// status is re-checked before the first send and before every batch, so a
// closed alert sends nothing more. Idempotent: createNotification keys on
// `safety_alert:<alert_id>:<user_id>` and only backfills missing channel
// attempts, so a retried job never double-notifies.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createNotification } from "../../notifications/service.ts";
import { chunked, resolveSafetyAudience, type AudienceMember } from "../../safety/recipients.ts";
import type { SafetyAudience, SafetyKind } from "../../safety/schemas.ts";
import type { JobHandler } from "../types.ts";

// Bounded parallelism: an emergency should reach a whole school in seconds, not minutes.
const BATCH = 20;

type Contacts = { sms?: string | null; email?: string | null };

async function contactsFor(
  admin: SupabaseClient<Database>,
  table: "staff" | "guardians",
  ids: readonly string[],
): Promise<Map<string, Contacts>> {
  const out = new Map<string, Contacts>();
  for (const part of chunked([...new Set(ids)])) {
    const { data, error } = await admin.from(table).select("id, phone, email").in("id", part);
    if (error) throw error;
    for (const row of data ?? []) out.set(row.id, { sms: row.phone, email: row.email });
  }
  return out;
}

async function isActive(admin: SupabaseClient<Database>, alertId: string): Promise<boolean> {
  const { data, error } = await admin.from("safety_alerts").select("status").eq("id", alertId).maybeSingle();
  if (error) throw error;
  return data?.status === "active";
}

export const notifySafetyAlert: JobHandler = async (job, { admin }) => {
  const alertId = job.payload.alert_id;
  if (typeof alertId !== "string" || alertId.length === 0) {
    throw new Error("notify.safety_alert: missing alert_id");
  }

  const { data: alert, error: alertError } = await admin
    .from("safety_alerts")
    .select("id, institution_id, kind, title, message, audience, status")
    .eq("id", alertId)
    .maybeSingle();
  if (alertError) throw alertError;
  // Missing, or closed before the job ran: nothing to send.
  if (!alert || alert.status !== "active") return;

  let sectionIds: string[] = [];
  if (alert.audience === "sections") {
    const { data, error } = await admin
      .from("safety_alert_sections")
      .select("class_section_id")
      .eq("alert_id", alert.id)
      .eq("institution_id", alert.institution_id);
    if (error) throw error;
    sectionIds = (data ?? []).map((r) => r.class_section_id);
    if (sectionIds.length === 0) return;
  }

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("name, settings")
    .eq("id", alert.institution_id)
    .single();
  if (institutionError) throw institutionError;
  const languages = (institution.settings as { communication?: { languages?: unknown } } | null)?.communication?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  const members = await resolveSafetyAudience(admin, alert.institution_id, alert.audience as SafetyAudience, sectionIds);
  const [staffContacts, guardianContacts] = await Promise.all([
    contactsFor(admin, "staff", members.flatMap((m) => (m.staffId ? [m.staffId] : []))),
    contactsFor(admin, "guardians", members.flatMap((m) => (m.guardianId ? [m.guardianId] : []))),
  ]);
  const contactsOf = (m: AudienceMember): Contacts =>
    (m.staffId ? staffContacts.get(m.staffId) : undefined) ?? (m.guardianId ? guardianContacts.get(m.guardianId) : undefined) ?? {};

  const vars = { kind: alert.kind as SafetyKind, title: alert.title, message: alert.message, school: institution.name };

  for (const [i, batch] of chunked(members, BATCH).entries()) {
    if (i > 0 && !(await isActive(admin, alert.id))) return;
    await Promise.all(
      batch.map((m) =>
        createNotification(admin, {
          institutionId: alert.institution_id,
          recipientUserId: m.userId,
          type: "safety_alert",
          entityId: alert.id,
          lang,
          vars,
          contacts: contactsOf(m),
        }),
      ),
    );
  }
};
