// M11-T6 — pure schedule-conflict detector for exam_papers. No DB/server
// access (unlike queries.ts): callers pass already-fetched rows so this can
// run in a server action/query or a unit test. tz pattern mirrors
// timetable/queries.ts's nowPartsInInstitutionTimezone.
import { AppError, mapSqlError } from "@/lib/actions/result";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MINUTES_PER_DAY = 24 * 60;

// M16 security review (MEDIUM): these two lived in actions.ts, a "use server"
// file, which breaks every "use server" action in the app, because
// throwMappedSchedule was exported but not async (Next.js requires every
// exported binding in a "use server" file to be an async Server Action).
// This file has no "use server" directive, so plain helper exports are fine.
export function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

// M11 security review fix round 1: mapSqlError only maps `code:<ErrorCode>`
// exception messages, not raw PostgREST error codes — a real RLS violation
// or check-constraint hit on schedulePapers's exam_papers select/update
// calls (e.g. a row deleted between the pre-check and the write) fell
// through to a generic "internal" error instead of the mapping the M11
// rulings specify (42501 -> forbidden, 23514/23503/22P02 -> validation_failed),
// matching the question-bank/actions.ts isRlsViolation precedent.
const PG_FORBIDDEN_CODE = "42501";
const PG_VALIDATION_CODES = new Set(["23514", "23503", "22P02"]);

export function throwMappedSchedule(error: unknown): never {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === PG_FORBIDDEN_CODE) throw new AppError("forbidden", "Outside your teaching scope.");
  if (typeof code === "string" && PG_VALIDATION_CODES.has(code)) {
    throw new AppError("validation_failed", "Invalid schedule data.");
  }
  throwMapped(error);
}

/** `settings.locale.timezone`, same fallback as timetable/attendance queries.ts. */
export function institutionTimeZone(settings: Record<string, unknown>): string {
  const parsed = InstitutionSettingsSchema.shape.locale.safeParse(settings.locale);
  return parsed.success ? parsed.data.timezone : "Asia/Kolkata";
}

/** Institution-local date/weekday/time for a UTC instant. */
export function localParts(iso: string, timeZone: string): { date: string; weekday: number; hhmm: string } {
  const instant = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const weekday = WEEKDAY_LABELS.indexOf(byType.get("weekday") ?? "Mon");
  return { date, weekday: weekday < 0 ? 1 : weekday, hhmm: `${byType.get("hour")}:${byType.get("minute")}` };
}

export interface ScheduledPaper {
  id: string;
  classSectionId: string;
  sectionLabel: string;
  roomId: string | null;
  roomName: string | null;
  scheduledAt: string;
  durationMinutes: number;
}

export interface RoomSlot {
  roomId: string;
  weekday: number; // 1-6 (Mon-Sat; timetable has no Sunday periods)
  startsAt: string; // "HH:MM"
  endsAt: string; // "HH:MM"
  label: string;
}

export interface ExamScheduleConflict {
  kind: "section_double_booked" | "room_timetable_clash";
  exam_paper_id: string;
  other_exam_paper_id: string | null;
  section_label: string;
  room: string | null;
  starts_at: string;
  detail: string;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** [start, start+duration) in minutes-since-local-midnight, clamped to 24:00 for a paper that runs past local midnight (rulings). */
function localInterval(paper: ScheduledPaper, timeZone: string): { weekday: number; startMin: number; endMin: number } {
  const { weekday, hhmm } = localParts(paper.scheduledAt, timeZone);
  const startMin = hhmmToMinutes(hhmm);
  return { weekday, startMin, endMin: Math.min(startMin + paper.durationMinutes, MINUTES_PER_DAY) };
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Section double-bookings and room/timetable clashes among one exam's papers (rulings "Conflict kinds"). Not a constraint — reporting only. */
export function detectScheduleConflicts(
  papers: ScheduledPaper[],
  roomSlots: RoomSlot[],
  timeZone: string,
): ExamScheduleConflict[] {
  const conflicts: ExamScheduleConflict[] = [];
  const endMs = (p: ScheduledPaper) => new Date(p.scheduledAt).getTime() + p.durationMinutes * 60_000;

  for (let i = 0; i < papers.length; i++) {
    for (let j = i + 1; j < papers.length; j++) {
      const a = papers[i];
      const b = papers[j];
      if (a.classSectionId !== b.classSectionId) continue;
      if (!overlaps(new Date(a.scheduledAt).getTime(), endMs(a), new Date(b.scheduledAt).getTime(), endMs(b))) continue;
      conflicts.push({
        kind: "section_double_booked",
        exam_paper_id: a.id,
        other_exam_paper_id: b.id,
        section_label: a.sectionLabel,
        room: a.roomName,
        starts_at: a.scheduledAt,
        detail: `${a.sectionLabel} has two papers scheduled at overlapping times`,
      });
    }
  }

  for (const paper of papers) {
    if (!paper.roomId) continue;
    const { weekday, startMin, endMin } = localInterval(paper, timeZone);
    if (weekday === 0) continue; // Sunday: no timetable to clash with
    for (const slot of roomSlots) {
      if (slot.roomId !== paper.roomId || slot.weekday !== weekday) continue;
      if (!overlaps(startMin, endMin, hhmmToMinutes(slot.startsAt), hhmmToMinutes(slot.endsAt))) continue;
      conflicts.push({
        kind: "room_timetable_clash",
        exam_paper_id: paper.id,
        other_exam_paper_id: null,
        section_label: paper.sectionLabel,
        room: paper.roomName,
        starts_at: paper.scheduledAt,
        detail: `${paper.roomName ?? "Room"} has timetable slot "${slot.label}" at this time`,
      });
    }
  }

  return conflicts.sort((x, y) => (x.starts_at < y.starts_at ? -1 : x.starts_at > y.starts_at ? 1 : 0));
}
