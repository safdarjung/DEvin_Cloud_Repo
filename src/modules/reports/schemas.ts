// M15-T2 — Zod schemas for reports.* actions. Relative + .ts import: mirrors
// src/modules/notifications/announcements.schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const REPORT_SOURCE_KEYS = ["attendance.daily", "finance.defaulters"] as const;
export type ReportSourceKey = (typeof REPORT_SOURCE_KEYS)[number];

export const CRON_SUBSET_PATTERN =
  "^([0-9]|[1-5][0-9]) ([0-9]|1[0-9]|2[0-3]) (\\*|([0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*)) (\\*|([0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*)) (\\*|([0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*))$";

export const CronSchema = z
  .string()
  .trim()
  .max(100, "Cron expression must not exceed 100 characters")
  .regex(
    new RegExp(CRON_SUBSET_PATTERN),
    "Invalid cron format. Allowed: M (0-59) H (0-23) DOM (1-31|*) MON (1-12|*) DOW (0-6|*) with ranges (a-b) and lists (a,b,c), no steps or names"
  )
  .refine(
    (cron) => {
      const parts = cron.split(" ");
      const dom = parts[2];
      const dow = parts[4];
      const domRestricted = dom !== "*";
      const dowRestricted = dow !== "*";
      return !(domRestricted && dowRestricted);
    },
    "DOM and DOW cannot both be restricted"
  );
export type CronInput = z.infer<typeof CronSchema>;

export const AttendanceDailyParamsSchema = z
  .object({
    dayOffset: z.number().int().refine((val) => val === 0 || val === -1, {
      message: "dayOffset must be 0 or -1",
    }).default(0),
  })
  .strict();
export type AttendanceDailyParams = z.infer<typeof AttendanceDailyParamsSchema>;

export const FeeDefaultersParamsSchema = z
  .object({
    minDaysOverdue: z.number().int().min(0).max(365).default(0),
  })
  .strict();
export type FeeDefaultersParams = z.infer<typeof FeeDefaultersParamsSchema>;

// Recipient role allowlists per source (from rulings)
const ATTENDANCE_DAILY_RECIPIENTS = ["owner", "principal", "admin"] as const;
const FINANCE_DEFAULTERS_RECIPIENTS = ["owner", "principal", "admin", "accountant"] as const;

export const ReportExportSchema = z
  .discriminatedUnion("source", [
    z.object({
      source: z.literal("attendance.daily"),
      params: AttendanceDailyParamsSchema.optional(),
    }).strict(),
    z.object({
      source: z.literal("finance.defaulters"),
      params: FeeDefaultersParamsSchema.optional(),
    }).strict(),
  ]);
export type ReportExportInput = z.infer<typeof ReportExportSchema>;

const roleEnum = z.enum(["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"]);
const recipientRoles = z
  .array(roleEnum)
  .min(1, "At least one recipient role required")
  .max(5, "Maximum 5 recipient roles allowed")
  .refine((roles) => new Set(roles).size === roles.length, "Recipient roles must be unique");

export const ScheduleSaveSchema = z
  .discriminatedUnion("source", [
    z
      .object({
        id: uuid.optional(),
        name: z.string().trim().min(1).max(80),
        source: z.literal("attendance.daily"),
        params: AttendanceDailyParamsSchema.optional(),
        cron: CronSchema,
        recipientRoles,
      })
      .strict()
      .refine(
        (data) => {
          const allowedRoles = ATTENDANCE_DAILY_RECIPIENTS;
          return data.recipientRoles.every((role) =>
            allowedRoles.includes(role as (typeof ATTENDANCE_DAILY_RECIPIENTS)[number])
          );
        },
        { message: "Recipient roles not allowed for attendance.daily source" }
      ),
    z
      .object({
        id: uuid.optional(),
        name: z.string().trim().min(1).max(80),
        source: z.literal("finance.defaulters"),
        params: FeeDefaultersParamsSchema.optional(),
        cron: CronSchema,
        recipientRoles,
      })
      .strict()
      .refine(
        (data) => {
          const allowedRoles = FINANCE_DEFAULTERS_RECIPIENTS;
          return data.recipientRoles.every((role) =>
            allowedRoles.includes(role as (typeof FINANCE_DEFAULTERS_RECIPIENTS)[number])
          );
        },
        { message: "Recipient roles not allowed for finance.defaulters source" }
      ),
  ]);
export type ScheduleSaveInput = z.infer<typeof ScheduleSaveSchema>;

export const ScheduleStatusSchema = z
  .object({
    id: uuid,
    status: z.enum(["active", "paused"]),
  })
  .strict();
export type ScheduleStatusInput = z.infer<typeof ScheduleStatusSchema>;

export const ReportRunsSchema = z
  .object({
    reportId: uuid,
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ReportRunsInput = z.infer<typeof ReportRunsSchema>;

export const ReportListSchema = z.object({}).strict();
export type ReportListInput = z.infer<typeof ReportListSchema>;

// Row type for database returns
export interface ScheduledReportRow {
  id: string;
  name: string;
  source: ReportSourceKey;
  params: Record<string, unknown>;
  cron: string;
  recipientRoles: string[];
  status: "active" | "paused";
  nextRunAt: string | null;
  createdAt: string;
}
