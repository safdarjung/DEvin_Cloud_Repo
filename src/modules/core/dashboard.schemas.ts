// M16-T1 — zod schemas for dashboard queries. Relative + .ts import: mirrors
// src/modules/timetable/schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts"

export const AttendanceTrendSchema = z
  .object({
    days: z.number().int().min(7).max(92).default(30),
    classSectionId: uuid.optional(),
    studentId: uuid.optional(),
  })
  .strict()
  .refine((data) => !(data.classSectionId && data.studentId), {
    message: "Cannot specify both classSectionId and studentId",
    path: ["classSectionId"],
  });
export type AttendanceTrendInput = z.infer<typeof AttendanceTrendSchema>;

export const PortalDashboardSchema = z
  .object({
    studentId: uuid,
  })
  .strict();
export type PortalDashboardInput = z.infer<typeof PortalDashboardSchema>;
