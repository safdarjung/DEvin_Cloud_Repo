"use server";

// Safety alerts (migration 0129). API roles only hold SELECT: every write goes
// through a definer that re-checks role, audience, alert state and the hourly
// cap, and writes its own audit row (ids only; an acknowledgement row is its
// own record). Never AI-draftable (§E): send, close, headcount — a drill may
// only be pre-filled into the send form; a human clicks send.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { runJobNow } from "@/modules/jobs/runner";
import { createJobsAdminClient } from "@/modules/jobs/with-service-role";
import { resolveSafetyAudience } from "./recipients";
import {
  AlertAudienceSchema,
  AlertIdSchema,
  AlertSendSchema,
  HeadcountSchema,
  type AlertAudienceInput,
  type AlertIdInput,
  type AlertSendInput,
  type HeadcountInput,
} from "./schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface AudiencePreview {
  total: number;
  staff: number;
  students: number;
  guardians: number;
}

/** Read-only: the "This will notify N people" count for the confirm step — same resolver the notify job uses. */
export const previewSafetyAudience = defineAction({
  name: "safety.alert.preview",
  module: "safety",
  schema: AlertAudienceSchema,
  permission: "safety.alert.send",
  handler: async ({ audience, sectionIds }: AlertAudienceInput, ctx): Promise<AudiencePreview> => {
    const supabase = await createClient();
    const members = await resolveSafetyAudience(supabase, ctx.institution.id, audience, sectionIds ?? []);
    return {
      total: members.length,
      staff: members.filter((m) => m.group === "staff").length,
      students: members.filter((m) => m.group === "student").length,
      guardians: members.filter((m) => m.group === "guardian").length,
    };
  },
});

// No scheduler is guaranteed: deliver in this request, the job runner is the retry path.
const IN_REQUEST_DELIVERY_MS = 15_000;

/**
 * Runs the alert's own notify.safety_alert job now (claim → run → complete).
 * Ids come from the definer's returned row and ctx, never from the client.
 * Any failure leaves the job queued for the runner; logged with ids only.
 */
async function deliverNow(institutionId: string, alertId: string): Promise<"sent" | "queued"> {
  try {
    const ran = await runJobNow(createJobsAdminClient(), {
      institutionId,
      idempotencyKey: `safety_alert:${alertId}`, // key set by create_safety_alert (0129)
      timeoutMs: IN_REQUEST_DELIVERY_MS,
    });
    return ran ? "sent" : "queued";
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.error(`[${crypto.randomUUID()}] safety alert ${alertId}: in-request delivery failed, job left queued`, {
      code: typeof code === "string" ? code : err instanceof Error ? err.name : "unknown",
    });
    return "queued";
  }
}

export const sendSafetyAlert = defineAction({
  name: "safety.alert.send",
  module: "safety",
  schema: AlertSendSchema,
  permission: "safety.alert.send",
  handler: async ({ kind, title, message, audience, sectionIds }: AlertSendInput, ctx): Promise<{ id: string; delivery: "sent" | "queued" }> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_safety_alert", {
      p_institution_id: ctx.institution.id,
      p_kind: kind,
      p_title: title,
      p_message: message,
      p_audience: audience,
      p_section_ids: sectionIds ?? [],
    });
    if (error) throwMapped(error);
    return { id: data.id, delivery: await deliverNow(ctx.institution.id, data.id) };
  },
});

export const closeSafetyAlert = defineAction({
  name: "safety.alert.close",
  module: "safety",
  schema: AlertIdSchema,
  permission: "safety.alert.send",
  handler: async ({ alertId }: AlertIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("close_safety_alert", { p_institution_id: ctx.institution.id, p_alert_id: alertId });
    if (error) throwMapped(error);
    return { id: data.id };
  },
});

export const acknowledgeSafetyAlert = defineAction({
  name: "safety.alert.acknowledge",
  module: "safety",
  schema: AlertIdSchema,
  permission: "safety.alert.read",
  handler: async ({ alertId }: AlertIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("acknowledge_safety_alert", { p_institution_id: ctx.institution.id, p_alert_id: alertId });
    if (error) throwMapped(error);
    return { id: data.id };
  },
});

export const markSafetyHeadcount = defineAction({
  name: "safety.headcount.mark",
  module: "safety",
  schema: HeadcountSchema,
  permission: "safety.headcount.mark",
  handler: async ({ alertId, classSectionId, presentCount, missingCount, note }: HeadcountInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mark_safety_headcount", {
      p_institution_id: ctx.institution.id,
      p_alert_id: alertId,
      p_class_section_id: classSectionId,
      p_present_count: presentCount,
      p_missing_count: missingCount,
      p_note: note ?? "", // definer stores blank as null
    });
    if (error) throwMapped(error);
    return { id: data.id };
  },
});
