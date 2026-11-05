import "server-only";
// M15-T11 — report.* reads (rulings "Names"). RLS is the only row filter for
// report.list/report.runs (0077's scheduled_reports/documents policies);
// report.export additionally checks the source's own permission in-handler
// (rulings: "data.export AND the source's own permission") before running
// it through the caller's client, same shape as every other queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { AppError } from "@/lib/actions/result";
import { hasPermission } from "@/lib/auth/require";
import { REPORT_SOURCES, runReportSource } from "@/modules/reports/sources";
import type { ReportExportInput, ReportSourceKey, ScheduledReportRow } from "@/modules/reports/schemas";

export async function reportList(ctx: TenantContext): Promise<ScheduledReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_reports")
    .select("id, name, source, params, cron, recipient_roles, status, next_run_at, created_at")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    source: row.source as ReportSourceKey,
    params: row.params as Record<string, unknown>,
    cron: row.cron,
    recipientRoles: row.recipient_roles,
    status: row.status as ScheduledReportRow["status"],
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  }));
}

export interface ReportRun {
  documentId: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export async function reportRuns(ctx: TenantContext, reportId: string, limit: number): Promise<ReportRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, size_bytes, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("entity_type", "report")
    .eq("entity_id", reportId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    documentId: row.id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }));
}

export async function reportExport(
  ctx: TenantContext,
  input: ReportExportInput,
): Promise<{ rows: Record<string, unknown>[] }> {
  const source = REPORT_SOURCES[input.source];
  if (!hasPermission(ctx, source.permission)) {
    throw new AppError("forbidden", "You do not have permission to run this report.");
  }
  const supabase = await createClient();
  const rows = await runReportSource(
    supabase,
    input.source,
    ctx.institution.id,
    input.params ?? {},
    new Date().toISOString(),
  );
  return { rows };
}
