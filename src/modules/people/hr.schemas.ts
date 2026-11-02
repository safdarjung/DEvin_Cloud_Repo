// M08-T5 — Zod schemas for people (HR) actions. Relative + .ts import: mirrors
// src/modules/notifications/announcements.schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

const attendanceStatus = z.enum(["present", "absent", "late", "half_day"]);
const leaveType = z.enum(["casual", "sick", "earned", "unpaid", "other"]);
const leaveStatus = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const StaffAttendanceMarkSchema = z
  .object({
    date: isoDate,
    records: z
      .array(
        z.object({
          staffId: uuid,
          status: attendanceStatus,
          note: z.string().trim().max(200).optional(),
        })
      )
      .min(1)
      .max(300),
  })
  .strict();
export type StaffAttendanceMarkInput = z.infer<typeof StaffAttendanceMarkSchema>;

export const CheckInSchema = z.object({}).strict();
export type CheckInInput = z.infer<typeof CheckInSchema>;

export const LeaveRequestSchema = z
  .object({
    staffId: uuid.optional(),
    leaveType,
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine((data) => data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .refine(
    (data) => {
      // Calculate days inclusive: end - start + 1
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      const daysInclusive = Math.floor(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
      return daysInclusive <= 31;
    },
    {
      message: "leave period cannot exceed 31 days",
      path: ["endDate"],
    }
  );
export type LeaveRequestInput = z.infer<typeof LeaveRequestSchema>;

export const LeaveDecisionSchema = z
  .object({
    leaveId: uuid,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type LeaveDecisionInput = z.infer<typeof LeaveDecisionSchema>;

export const LeaveCancelSchema = z.object({ leaveId: uuid }).strict();
export type LeaveCancelInput = z.infer<typeof LeaveCancelSchema>;

export const LeaveListSchema = z
  .object({
    status: leaveStatus.optional(),
    staffId: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type LeaveListInput = z.infer<typeof LeaveListSchema>;

export const StaffAttendanceForDateSchema = z
  .object({
    date: isoDate.optional(),
  })
  .strict();
export type StaffAttendanceForDateInput = z.infer<
  typeof StaffAttendanceForDateSchema
>;
