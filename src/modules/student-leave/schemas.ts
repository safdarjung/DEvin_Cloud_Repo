// X01-T3 — Zod schemas for student leave. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

export const STUDENT_LEAVE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;

const studentLeaveStatus = z.enum(STUDENT_LEAVE_STATUSES);

export const StudentLeaveRequestSchema = z
  .object({
    studentId: uuid,
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
      const daysInclusive =
        Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
      return daysInclusive <= 31;
    },
    {
      message: "leave period cannot exceed 31 days",
      path: ["endDate"],
    }
  );
export type StudentLeaveRequestInput = z.infer<
  typeof StudentLeaveRequestSchema
>;

export const StudentLeaveDecisionSchema = z
  .object({
    leaveId: uuid,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type StudentLeaveDecisionInput = z.infer<
  typeof StudentLeaveDecisionSchema
>;

export const StudentLeaveCancelSchema = z
  .object({
    leaveId: uuid,
  })
  .strict();
export type StudentLeaveCancelInput = z.infer<typeof StudentLeaveCancelSchema>;

export const StudentLeaveListSchema = z
  .object({
    status: studentLeaveStatus.optional(),
    studentId: uuid.optional(),
    classSectionId: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type StudentLeaveListInput = z.infer<typeof StudentLeaveListSchema>;
