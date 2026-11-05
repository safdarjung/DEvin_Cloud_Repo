// M15-T9 — job handler `report.generate` (M15-tasks.md rulings "Handler",
// "Idempotency"). Plain node: relative `.ts` imports; `@/` only for types.
// Payload `{ scheduled_report_id, fire_at }` built by `public.enqueue_due_reports`
// (T5) — never trust it beyond those two ids, everything else is re-read.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { rowsToCsvText } from "../../../lib/http/csv-text.ts";
import { createNotification } from "../../notifications/service.ts";
import { REPORT_SOURCES, runReportSource } from "../../reports/sources.ts";
import type { ReportSourceKey } from "../../reports/schemas.ts";
import type { JobHandler } from "../types.ts";

const BUCKET = "tenant-docs";
const MAX_CSV_BYTES = 10_485_760;
const DEFAULT_TZ = "Asia/Kolkata";

function slugify(input: string): string {
  const slug = input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "report";
}

/** UTC stamp for the storage path — deterministic per (schedule, fire_at) window, so a retry/replay uploads to the same object (idempotency). */
function utcStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
}

/** Same `en-CA` -> YYYY-MM-DD pattern as attendance/timetable queries.ts (institution-local date). */
function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

async function institutionTimezone(admin: SupabaseClient<Database>, institutionId: string): Promise<string> {
  const { data, error } = await admin.from("institutions").select("settings").eq("id", institutionId).single();
  if (error) throw error;
  const settings = data.settings as { locale?: { timezone?: unknown } } | null;
  const tz = settings?.locale?.timezone;
  return typeof tz === "string" && tz.length > 0 ? tz : DEFAULT_TZ;
}

export const generateReport: JobHandler = async (job, { admin }) => {
  const scheduledReportId = job.payload.scheduled_report_id;
  const fireAt = job.payload.fire_at;
  if (typeof scheduledReportId !== "string" || scheduledReportId.length === 0 || typeof fireAt !== "string" || fireAt.length === 0) {
    throw new Error("report.generate: missing scheduled_report_id or fire_at");
  }

  const { data: schedule, error: scheduleError } = await admin
    .from("scheduled_reports")
    .select("id, institution_id, name, source, params, recipient_roles, status, created_by")
    .eq("id", scheduledReportId)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  // Re-check state at send time: deleted, or paused since enqueue -> skip rather than send stale.
  if (!schedule || schedule.status !== "active") return;

  const source = schedule.source as ReportSourceKey;
  if (!Object.hasOwn(REPORT_SOURCES, source)) throw new Error("report.generate: unknown source");
  const sourceDef = REPORT_SOURCES[source];
  const parsedParams = sourceDef.params.safeParse(schedule.params);
  if (!parsedParams.success) throw new Error("report.generate: invalid_params");

  const rows = await runReportSource(admin, source, schedule.institution_id, parsedParams.data, fireAt);
  const csvText = rowsToCsvText(rows, sourceDef.columns);
  if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) throw new Error("report.generate: report_too_large");

  const tz = await institutionTimezone(admin, schedule.institution_id);
  const dateLocal = localDate(fireAt, tz);
  const path = `${schedule.institution_id}/report/${schedule.id}/${utcStamp(fireAt)}.csv`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, csvText, { contentType: "text/csv", upsert: true });
  if (uploadError) throw uploadError;

  const fileNameBase = `${slugify(schedule.name)}-${dateLocal}`;
  const fileName = `${fileNameBase.slice(0, 196)}.csv`;

  const { error: upsertError } = await admin.from("documents").upsert(
    {
      institution_id: schedule.institution_id,
      entity_type: "report",
      entity_id: schedule.id,
      kind: "scheduled_report",
      file_name: fileName,
      mime: "text/csv",
      size_bytes: Buffer.byteLength(csvText, "utf8"),
      path,
      status: "active",
      created_by: schedule.created_by,
    },
    { onConflict: "path", ignoreDuplicates: true },
  );
  if (upsertError) throw upsertError;

  // Re-read by path (lesson 11): `ignoreDuplicates` returns no row on a
  // replay's conflict, so the document id always comes from a fresh select.
  const { data: document, error: documentError } = await admin
    .from("documents")
    .select("id")
    .eq("path", path)
    .single();
  if (documentError) throw documentError;

  const { data: recipients, error: recipientsError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("institution_id", schedule.institution_id)
    .eq("status", "active")
    .in("role", schedule.recipient_roles);
  if (recipientsError) throw recipientsError;

  for (const recipient of recipients ?? []) {
    await createNotification(admin, {
      institutionId: schedule.institution_id,
      recipientUserId: recipient.user_id,
      type: "report_ready",
      entityId: document.id,
      vars: { report: schedule.name, date: dateLocal },
    });
  }
};
