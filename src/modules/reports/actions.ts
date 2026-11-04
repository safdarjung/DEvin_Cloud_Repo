"use server";

// M15-T10 — report.schedule.save / report.schedule.setStatus (M15-tasks.md
// rulings "Names"; migration 0077's scheduled_reports + write guard carry
// the cron/role/name-conflict checks). Insert/update-by-id + conflict
// mapping mirrors timetable/actions.ts's upsertRoom/upsertPeriod.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  ScheduleSaveSchema,
  ScheduleStatusSchema,
  type ScheduledReportRow,
  type ScheduleSaveInput,
  type ScheduleStatusInput,
} from "@/modules/reports/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";

const SELECT_COLUMNS = "id, name, source, params, cron, recipient_roles, status, next_run_at, created_at";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

function mapRow(row: Record<string, unknown>): ScheduledReportRow {
  return {
    id: row.id as string,
    name: row.name as string,
    source: row.source as ScheduledReportRow["source"],
    params: row.params as Record<string, unknown>,
    cron: row.cron as string,
    recipientRoles: row.recipient_roles as string[],
    status: row.status as ScheduledReportRow["status"],
    nextRunAt: (row.next_run_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export const saveScheduledReport = defineAction({
  name: "report.schedule.save",
  module: "scheduled_reports",
  schema: ScheduleSaveSchema,
  permission: "report.schedule",
  handler: async ({ id, name, source, params, cron, recipientRoles }: ScheduleSaveInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      name,
      source,
      params: params ?? {},
      cron,
      recipient_roles: recipientRoles,
    };
    // created_by is immutable after insert (write guard); the trigger
    // forces it to app.current_user_id() for a non-trusted caller anyway,
    // so the value supplied here only satisfies the generated Insert type.
    const query = id
      ? supabase.from("scheduled_reports").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("scheduled_reports").insert({ ...row, created_by: ctx.user.id });
    const { data, error } = await query.select(SELECT_COLUMNS).maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A scheduled report with this name already exists.", {
          name: ["Name already in use."],
        });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Scheduled report not found.");

    await audit(ctx, {
      action: "report.schedule.saved",
      entityType: "scheduled_report",
      entityId: data.id as string,
      metadata: { id: data.id, source: data.source },
    });

    return mapRow(data);
  },
});

export const setScheduledReportStatus = defineAction({
  name: "report.schedule.setStatus",
  module: "scheduled_reports",
  schema: ScheduleStatusSchema,
  permission: "report.schedule",
  handler: async ({ id, status }: ScheduleStatusInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("scheduled_reports")
      .update({ status })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select(SELECT_COLUMNS)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Scheduled report not found.");

    await audit(ctx, {
      action: "report.schedule.status_set",
      entityType: "scheduled_report",
      entityId: data.id as string,
      metadata: { id: data.id, status: data.status },
    });

    return mapRow(data);
  },
});
