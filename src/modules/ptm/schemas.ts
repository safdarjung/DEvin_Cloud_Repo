// X08-T4 — Zod schemas for PTM and survey actions/queries. Relative + .ts import:
// seed-script safe (mirrors src/modules/notifications/announcements.schemas.ts).
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

// Constants
export const PTM_SLOT_MINUTES = [5, 10, 15, 20, 30] as const;
export const SURVEY_QUESTION_TYPES = ["single", "multi", "text"] as const;
export const SURVEY_MAX_QUESTIONS = 10;
export const SURVEY_MIN_ANON_RESPONSES = 3;

// Time pattern for HH:MM
const timePattern = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time format, use HH:MM");

// ISO datetime with offset pattern
const isoDateTimeWithOffset = z.string().datetime({ offset: true });

// PTM Event Create Schema
export const PtmEventCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    eventDate: isoDate,
    dayStartsAt: timePattern,
    dayEndsAt: timePattern,
    slotMinutes: z.number().int().refine((val) => {
      return PTM_SLOT_MINUTES.includes(val as typeof PTM_SLOT_MINUTES[number]);
    }, {
      message: "slotMinutes must be one of: 5, 10, 15, 20, 30",
    }),
    bookingClosesAt: isoDateTimeWithOffset,
    classSectionIds: z.array(uuid).min(1).max(100),
  })
  .strict()
  .refine((data) => data.dayEndsAt > data.dayStartsAt, {
    message: "dayEndsAt must be after dayStartsAt",
    path: ["dayEndsAt"],
  })
  .refine((data) => {
    // Calculate slot count: (time difference in minutes) / slotMinutes
    const [startHour, startMin] = data.dayStartsAt.split(":").map(Number);
    const [endHour, endMin] = data.dayEndsAt.split(":").map(Number);
    const totalMinutes = endHour * 60 + endMin - (startHour * 60 + startMin);
    const slotCount = totalMinutes / data.slotMinutes;
    return slotCount >= 1 && slotCount <= 60;
  }, {
    message: "Slot count must be between 1 and 60",
    path: ["slotMinutes"],
  })
  .refine((data) => {
    // booking_closes_at must be before ${eventDate}T${dayStartsAt}:00+05:30
    const eventStart = new Date(`${data.eventDate}T${data.dayStartsAt}:00+05:30`);
    const bookingCloses = new Date(data.bookingClosesAt);
    return bookingCloses < eventStart;
  }, {
    message: "bookingClosesAt must be before the event start time",
    path: ["bookingClosesAt"],
  });
export type PtmEventCreateInput = z.infer<typeof PtmEventCreateSchema>;

// PTM Event Publish Schema
export const PtmEventPublishSchema = z.object({ eventId: uuid }).strict();
export type PtmEventPublishInput = z.infer<typeof PtmEventPublishSchema>;

// PTM Slots Add Schema
export const PtmSlotsAddSchema = z
  .object({
    eventId: uuid,
    staffId: uuid.optional(),
    from: timePattern,
    to: timePattern,
  })
  .strict()
  .refine((data) => data.to > data.from, {
    message: "to must be after from",
    path: ["to"],
  });
export type PtmSlotsAddInput = z.infer<typeof PtmSlotsAddSchema>;

// PTM Slot Remove Schema
export const PtmSlotRemoveSchema = z.object({ slotId: uuid }).strict();
export type PtmSlotRemoveInput = z.infer<typeof PtmSlotRemoveSchema>;

// PTM Book Schema
export const PtmBookSchema = z
  .object({
    slotId: uuid,
    studentId: uuid,
  })
  .strict();
export type PtmBookInput = z.infer<typeof PtmBookSchema>;

// PTM Cancel Schema
export const PtmCancelSchema = z.object({ bookingId: uuid }).strict();
export type PtmCancelInput = z.infer<typeof PtmCancelSchema>;

// PTM Events Query Schema
export const PtmEventsQuerySchema = z
  .object({
    includePast: z.boolean().optional(),
  })
  .strict();
export type PtmEventsQueryInput = z.infer<typeof PtmEventsQuerySchema>;

// PTM Schedule Schema
export const PtmScheduleSchema = z
  .object({
    eventId: uuid,
    staffId: uuid.optional(),
  })
  .strict();
export type PtmScheduleInput = z.infer<typeof PtmScheduleSchema>;

// PTM For Student Schema
export const PtmForStudentSchema = z
  .object({
    studentId: uuid,
    eventId: uuid.optional(),
  })
  .strict();
export type PtmForStudentInput = z.infer<typeof PtmForStudentSchema>;

// Survey Question Schema (discriminated union)
export const SurveyQuestionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("single"),
      prompt: z.string().trim().min(1).max(200),
      options: z
        .array(z.string().trim().min(1).max(80))
        .min(2)
        .max(6)
        .refine((opts) => new Set(opts).size === opts.length, {
          message: "Options must be distinct",
        }),
    })
    .strict(),
  z
    .object({
      type: z.literal("multi"),
      prompt: z.string().trim().min(1).max(200),
      options: z
        .array(z.string().trim().min(1).max(80))
        .min(2)
        .max(6)
        .refine((opts) => new Set(opts).size === opts.length, {
          message: "Options must be distinct",
        }),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      prompt: z.string().trim().min(1).max(200),
    })
    .strict(),
]);
export type SurveyQuestionInput = z.infer<typeof SurveyQuestionSchema>;

// Survey Audience Schema (mirrors announcement audiences but excludes student)
const SURVEY_AUDIENCE_ROLES = [
  "owner",
  "principal",
  "admin",
  "admissions",
  "accountant",
  "exam_controller",
  "teacher",
  "guardian",
] as const;

export const SurveyAudienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("school") }).strict(),
  z
    .object({ type: z.literal("role"), role: z.enum(SURVEY_AUDIENCE_ROLES) })
    .strict(),
  z
    .object({ type: z.literal("grade"), gradeId: uuid })
    .strict(),
  z
    .object({ type: z.literal("section"), classSectionId: uuid })
    .strict(),
]);
export type SurveyAudienceInput = z.infer<typeof SurveyAudienceSchema>;

// Survey Create Schema
export const SurveyCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    isAnonymous: z.boolean().default(true),
    closesAt: isoDateTimeWithOffset,
    questions: z.array(SurveyQuestionSchema).min(1).max(SURVEY_MAX_QUESTIONS),
    audiences: z.array(SurveyAudienceSchema).min(1).max(20),
  })
  .strict();
export type SurveyCreateInput = z.infer<typeof SurveyCreateSchema>;

// Survey Close Schema
export const SurveyCloseSchema = z.object({ surveyId: uuid }).strict();
export type SurveyCloseInput = z.infer<typeof SurveyCloseSchema>;

// Survey Respond Schema
export const SurveyRespondSchema = z
  .object({
    surveyId: uuid,
    answers: z
      .array(
        z.union([
          z.number().int().nonnegative(),
          z.array(z.number().int().nonnegative()).min(1).max(6),
          z.string().max(500),
        ])
      )
      .min(1)
      .max(SURVEY_MAX_QUESTIONS),
  })
  .strict();
export type SurveyRespondInput = z.infer<typeof SurveyRespondSchema>;

// Survey Results Schema
export const SurveyResultsSchema = z.object({ surveyId: uuid }).strict();
export type SurveyResultsInput = z.infer<typeof SurveyResultsSchema>;

// Survey List Schema
export const SurveyListSchema = z
  .object({
    status: z.enum(["draft", "open", "closed"]).optional(),
  })
  .strict();
export type SurveyListInput = z.infer<typeof SurveyListSchema>;

// My Surveys Schema
export const MySurveysSchema = z.object({}).strict();
export type MySurveysInput = z.infer<typeof MySurveysSchema>;
