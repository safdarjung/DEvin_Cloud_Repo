// New — AI attendance-pattern-insight request/response schemas (06 §W6,
// mirrors quiz.schemas.ts). `AttendancePatternInputSchema` is the wire
// shape of `AnonymizedAttendancePattern` — `.strict()` so an extra field
// (e.g. a name slipped in by a buggy caller) fails validation instead of
// silently passing through to the model.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

// Cap matches `MAX_PATTERN_STUDENTS` in `modules/attendance/queries.ts` —
// kept as a separate literal here since this schema must not import a
// "server-only" module.
const MAX_STUDENTS = 60;
const MAX_RECENT_DAYS = 10;

export const AttendancePatternInputSchema = z
  .object({
    index: z.number().int().min(0).max(MAX_STUDENTS - 1),
    presentCount: z.number().int().min(0),
    absentCount: z.number().int().min(0),
    lateCount: z.number().int().min(0),
    recentAbsentDayOffsets: z
      .array(z.number().int().min(0).max(MAX_RECENT_DAYS - 1))
      .max(MAX_RECENT_DAYS),
  })
  .strict();

export const AttendanceInsightRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    classSectionId: uuid,
    students: z.array(AttendancePatternInputSchema).min(1).max(MAX_STUDENTS),
  })
  .strict();

export type AttendanceInsightRequestInput = z.infer<typeof AttendanceInsightRequestSchema>;

export const AttendanceInsightItemSchema = z
  .object({
    index: z.number().int().min(0).max(MAX_STUDENTS - 1),
    note: z.string().trim().min(1).max(150),
  })
  .strict();

export type AttendanceInsightItem = z.infer<typeof AttendanceInsightItemSchema>;

// Object-wrapped (not a bare top-level array) — same shape convention as
// `QuizGenerationSchema`, since structured-output grammar generation is
// documented (quiz.schemas.ts phase 1b) to behave better with an object root.
export const AttendanceInsightGenerationSchema = z
  .object({
    items: z.array(AttendanceInsightItemSchema).max(MAX_STUDENTS),
  })
  .strict();

export type AttendanceInsightGeneration = z.infer<typeof AttendanceInsightGenerationSchema>;
