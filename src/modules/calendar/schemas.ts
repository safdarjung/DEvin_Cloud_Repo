// M13-T3 — Zod schemas for calendar.* actions. Relative + .ts import: mirrors
// src/modules/notifications/announcements.schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

export const CALENDAR_EVENT_KINDS = [
  "holiday",
  "exam_week",
  "ptm",
  "event",
] as const;

export const CALENDAR_AUDIENCES = ["all", "staff"] as const;

export const CalendarEventUpsertSchema = z
  .object({
    id: uuid.optional(),
    academicYearId: uuid,
    kind: z.enum(CALENDAR_EVENT_KINDS),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    startsOn: isoDate,
    endsOn: isoDate,
    audience: z.enum(CALENDAR_AUDIENCES).default("all"),
  })
  .strict()
  .refine((data) => data.endsOn >= data.startsOn, {
    message: "endsOn must be on or after startsOn",
    path: ["endsOn"],
  })
  .refine(
    (data) => {
      const start = new Date(data.startsOn);
      const end = new Date(data.endsOn);
      const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      return days <= 92;
    },
    {
      message: "Event span cannot exceed 92 days",
      path: ["endsOn"],
    }
  )
  .refine(
    (data) => {
      if (data.kind === "holiday" && data.audience !== "all") {
        return false;
      }
      return true;
    },
    {
      message: "Holiday events must have audience 'all'",
      path: ["audience"],
    }
  );
export type CalendarEventUpsertInput = z.infer<typeof CalendarEventUpsertSchema>;

export const CalendarEventDeleteSchema = z
  .object({
    id: uuid,
  })
  .strict();
export type CalendarEventDeleteInput = z.infer<typeof CalendarEventDeleteSchema>;

export const CalendarForRoleSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    kinds: z.array(z.enum(CALENDAR_EVENT_KINDS)).max(4).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    {
      message: "from must be on or before to",
      path: ["from"],
    }
  )
  .refine(
    (data) => {
      if (data.from && data.to) {
        const start = new Date(data.from);
        const end = new Date(data.to);
        const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        return days <= 366;
      }
      return true;
    },
    {
      message: "Date range cannot exceed 366 days",
      path: ["to"],
    }
  );
export type CalendarForRoleInput = z.infer<typeof CalendarForRoleSchema>;
