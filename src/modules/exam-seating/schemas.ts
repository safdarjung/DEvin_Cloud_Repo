// X06-T4 — Zod schemas for exam-seating actions and queries. Relative .ts import
// for seed-script safety (cf. src/modules/notifications/announcements.schemas.ts).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const GenerateSeatingSchema = z
  .object({
    examId: uuid,
    slotStart: z.string().datetime({ offset: true }),
    rooms: z
      .array(
        z
          .object({
            roomId: uuid,
            seats: z.number().int().min(1).max(500).optional(),
          })
          .strict()
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine((data) => new Set(data.rooms.map((r) => r.roomId)).size === data.rooms.length, {
    message: "Duplicate roomId in rooms.",
    path: ["rooms"],
  });
export type GenerateSeatingInput = z.infer<typeof GenerateSeatingSchema>;

export const SlotsQuerySchema = z.object({ examId: uuid }).strict();
export type SlotsQueryInput = z.infer<typeof SlotsQuerySchema>;

export const PlanIdSchema = z.object({ planId: uuid }).strict();
export type PlanIdInput = z.infer<typeof PlanIdSchema>;

export const StudentSeatsSchema = z.object({ studentId: uuid }).strict();
export type StudentSeatsInput = z.infer<typeof StudentSeatsSchema>;

export const AdmitCardsSchema = z
  .object({
    examId: uuid,
    classSectionId: uuid,
    studentId: uuid.optional(),
  })
  .strict();
export type AdmitCardsInput = z.infer<typeof AdmitCardsSchema>;

// Row types for T6–T8 queries.

export interface SlotRow {
  slotStart: string; // ISO datetime string
  localDate: string; // YYYY-MM-DD
  localTime: string; // HH:MM
  sections: { id: string; label: string }[];
  paperCount: number;
  studentCount: number;
  started: boolean;
  plan: {
    id: string;
    versionNo: number;
    seatCount: number;
    generatedAt: string; // ISO datetime string
    stale: boolean;
  } | null;
}

export interface ChartSeat {
  seatNo: number;
  studentId: string;
  studentName: string;
  admissionNo: string;
  rollNo: number | null;
  sectionLabel: string;
}

export interface SeatingChart {
  planId: string;
  institutionName: string;
  examName: string;
  slotStart: string; // ISO datetime string
  localDate: string; // YYYY-MM-DD
  localTime: string; // HH:MM
  versionNo: number;
  isCurrent: boolean;
  rooms: {
    room: { id: string; name: string };
    seats: ChartSeat[];
  }[];
}

export interface StudentSeatRow {
  planId: string;
  studentId: string;
  studentName: string;
  examName: string;
  slotStart: string; // ISO datetime string
  localDate: string; // YYYY-MM-DD
  localTime: string; // HH:MM
  room: { id: string; name: string };
  seatNo: number;
}

export interface AdmitCardPaper {
  subject: string;
  date: string; // YYYY-MM-DD
  weekday: string; // Three-letter abbreviation, e.g. "Mon"
  start: string; // HH:MM
  end: string; // HH:MM
  room: string | null;
  seatNo: number | null;
}

export interface AdmitCard {
  institutionName: string;
  examName: string;
  studentName: string;
  admissionNo: string;
  rollNo: number | null;
  sectionLabel: string;
  papers: AdmitCardPaper[];
}
