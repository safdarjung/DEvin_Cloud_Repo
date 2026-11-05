// M15-T6 — report source registry (rulings "Sources"). Each source is one
// allowlisted security-invoker SQL function (migration 0077, T4), called
// via `.rpc()` from both report.generate (service-role client) and
// report.export (caller's client, RLS on top) — no TS twin of the query.
// Relative .ts import for schemas (plain-node job handler loads this
// module); `@/` imports below are type-only and erased at build.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Database } from "@/lib/db/types";
import type { Permission } from "@/lib/auth/permissions";
import {
  AttendanceDailyParamsSchema,
  FeeDefaultersParamsSchema,
  type AttendanceDailyParams,
  type FeeDefaultersParams,
  type ReportSourceKey,
} from "./schemas.ts";

interface ReportSourceDef {
  permission: Permission;
  rpc: "report_attendance_daily" | "report_fee_defaulters";
  params: z.ZodType;
  columns: readonly string[];
  args(params: never): Record<string, unknown>;
}

export const REPORT_SOURCES: Readonly<Record<ReportSourceKey, ReportSourceDef>> = {
  "attendance.daily": {
    permission: "attendance.read",
    rpc: "report_attendance_daily",
    params: AttendanceDailyParamsSchema,
    columns: [
      "date",
      "grade",
      "section",
      "session_status",
      "enrolled",
      "marked",
      "present_weighted",
      "denominator",
      "percentage",
    ],
    args: (params: AttendanceDailyParams) => ({ p_day_offset: params.dayOffset }),
  },
  "finance.defaulters": {
    permission: "finance.read",
    rpc: "report_fee_defaulters",
    params: FeeDefaultersParamsSchema,
    columns: ["admission_no", "student", "grade", "section", "invoice_no", "due_on", "days_overdue", "outstanding"],
    args: (params: FeeDefaultersParams) => ({ p_min_days_overdue: params.minDaysOverdue }),
  },
} as unknown as Readonly<Record<ReportSourceKey, ReportSourceDef>>;

export async function runReportSource(
  client: SupabaseClient<Database>,
  key: ReportSourceKey,
  institutionId: string,
  params: unknown,
  asOf: string,
): Promise<Record<string, unknown>[]> {
  if (!Object.hasOwn(REPORT_SOURCES, key)) throw new Error(`Unknown report source: ${key}`);

  const source = REPORT_SOURCES[key];
  const parsed = source.params.parse(params);

  const { data, error } = await client.rpc(source.rpc, {
    p_institution_id: institutionId,
    p_as_of: asOf,
    ...source.args(parsed as never),
  });
  if (error) throw error;

  return (data ?? []) as Record<string, unknown>[];
}
