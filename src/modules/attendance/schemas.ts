// T-015 — attendance module schemas (06 §W5). Status codes are NOT validated
// here against `settings.attendance.statuses` — the schema has no access to
// `ctx` (defineAction parses before the handler runs); actions.ts validates
// the code dynamically against `ctx.institution.settings`, and the 0006
// trigger (`app.validate_attendance_status`) enforces it again at the DB
// layer regardless. `.strict()` on every object per CLAUDE.md rule 4.
import { z } from "zod";
import { isoDate, shortText, uuid } from "@/lib/schemas/common";

const attendanceStatusCode = z.string().trim().min(1).max(10);

export const MarkAttendanceSchema = z
  .object({
    classSectionId: uuid,
    date: isoDate,
    records: z
      .array(
        z
          .object({
            studentId: uuid,
            status: attendanceStatusCode,
            note: shortText.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type MarkAttendanceInput = z.infer<typeof MarkAttendanceSchema>;

export const SubmitAttendanceSchema = z.object({ sessionId: uuid }).strict();

export type SubmitAttendanceInput = z.infer<typeof SubmitAttendanceSchema>;

export const CorrectAttendanceSchema = z
  .object({
    recordId: uuid,
    newStatus: attendanceStatusCode,
    reason: shortText,
  })
  .strict();

export type CorrectAttendanceInput = z.infer<typeof CorrectAttendanceSchema>;

// M08-T6: Period attendance schemas
export const MarkPeriodAttendanceSchema = z
  .object({
    classSectionId: uuid,
    periodId: uuid,
    date: isoDate,
    records: z
      .array(
        z
          .object({
            studentId: uuid,
            status: attendanceStatusCode,
            note: shortText.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export type MarkPeriodAttendanceInput = z.infer<typeof MarkPeriodAttendanceSchema>;

export const PeriodSummarySchema = z
  .object({
    classSectionId: uuid,
    date: isoDate,
  })
  .strict();

export type PeriodSummaryInput = z.infer<typeof PeriodSummarySchema>;
