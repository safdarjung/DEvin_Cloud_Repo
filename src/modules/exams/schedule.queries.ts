import "server-only";
// M11-T7 — exams.schedule / exams.scheduleConflicts reads. `examSchedule`
// replaces the fabric fixture AssessmentPlanItem/assessmentPlan() (rulings
// "AssessmentPlanItem mapping"); `examScheduleConflicts` composes T6's pure
// detector with real rows (own exam_papers + timetable's published-version
// room slots). RLS (0009 exam_papers_select, staff-only) is the actual
// visibility filter — the institution_id filters below are defense in
// depth, same shape as the rest of this module's queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { AssessmentPlanItem } from "@/modules/fabric/types";
import { timetableRoomSlots } from "@/modules/timetable/queries";
import {
  detectScheduleConflicts,
  institutionTimeZone,
  type ExamScheduleConflict,
  type ScheduledPaper,
} from "./schedule-conflicts";

export interface ExamScheduleRow extends AssessmentPlanItem {
  exam_id: string;
  class_section_id: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  room: { id: string; name: string } | null;
}

interface ExamScheduleFilters {
  examId?: string;
  classSectionId?: string;
  from?: string;
  to?: string;
}

/** `exams.<type>` -> AssessmentPlanItem.kind (rulings: quiz/practical never emitted — no source type maps to them). */
function scheduleKind(type: string | undefined): AssessmentPlanItem["kind"] {
  return type === "unit_test" ? "unit_test" : "term_exam";
}

/** `exams.status` + whether the paper has a time -> AssessmentPlanItem.status (rulings). */
function scheduleStatus(examStatus: string | undefined, scheduledAt: string | null): AssessmentPlanItem["status"] {
  if (examStatus === "published") return "published";
  if (examStatus === "marks_entry" || examStatus === "verification") return "marked";
  return scheduledAt ? "scheduled" : "planned";
}

const SCHEDULE_PAGE = 1000;

/**
 * One row per exam_papers row with `held_on` set (rulings), ordered
 * held_on then scheduled_at (all rows, paged). `held_on` stays canonical even
 * when a direct PostgREST writer desyncs it from `scheduled_at` (rulings
 * "Schedule is not a constraint") — this query reports both columns as-is.
 */
export async function examSchedule(ctx: TenantContext, filters: ExamScheduleFilters): Promise<ExamScheduleRow[]> {
  const supabase = await createClient();
  // Paged with a stable order (held_on, scheduled_at, id): one PostgREST response stops at max_rows (1000).
  const data = [];
  for (let from = 0; ; from += SCHEDULE_PAGE) {
    let query = supabase
      .from("exam_papers")
      .select(
        "id, exam_id, class_section_id, held_on, scheduled_at, duration_minutes, exams!inner(name, type, status), subjects(name), class_sections(name, grades(code)), rooms(id, name)",
      )
      .eq("institution_id", ctx.institution.id)
      .not("held_on", "is", null)
      .order("held_on", { ascending: true })
      .order("scheduled_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + SCHEDULE_PAGE - 1);
    if (filters.examId) query = query.eq("exam_id", filters.examId);
    if (filters.classSectionId) query = query.eq("class_section_id", filters.classSectionId);
    if (filters.from) query = query.gte("held_on", filters.from);
    if (filters.to) query = query.lte("held_on", filters.to);
    const { data: page, error } = await query;
    if (error) throw error;
    data.push(...(page ?? []));
    if (!page || page.length < SCHEDULE_PAGE) break;
  }

  return data.map((row) => {
    const exam = row.exams as { name: string; type: string; status: string } | null;
    const subject = row.subjects as { name: string } | null;
    const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
    const room = row.rooms as { id: string; name: string } | null;
    return {
      id: row.id,
      title: exam?.name ?? "",
      subject: subject?.name ?? "",
      section_label: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`,
      date: row.held_on as string,
      kind: scheduleKind(exam?.type),
      status: scheduleStatus(exam?.status, row.scheduled_at),
      exam_id: row.exam_id,
      class_section_id: row.class_section_id,
      scheduled_at: row.scheduled_at,
      duration_minutes: row.duration_minutes,
      room: room ? { id: room.id, name: room.name } : null,
    };
  });
}

/** Section double-bookings + room/timetable clashes among one exam's scheduled papers (T6's pure detector, fed real rows). */
export async function examScheduleConflicts(ctx: TenantContext, examId: string): Promise<ExamScheduleConflict[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exam_papers")
    .select("id, class_section_id, scheduled_at, duration_minutes, room_id, class_sections(name, grades(code)), rooms(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("exam_id", examId)
    .not("scheduled_at", "is", null);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const papers: ScheduledPaper[] = rows.map((row) => {
    const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
    const room = row.rooms as { name: string } | null;
    return {
      id: row.id,
      classSectionId: row.class_section_id,
      sectionLabel: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`,
      roomId: row.room_id,
      roomName: room?.name ?? null,
      scheduledAt: row.scheduled_at as string,
      durationMinutes: row.duration_minutes as number,
    };
  });

  const roomIds = [...new Set(papers.map((p) => p.roomId).filter((id): id is string => id != null))];
  const roomSlots = roomIds.length > 0 ? await timetableRoomSlots(ctx, roomIds) : [];
  const timeZone = institutionTimeZone(ctx.institution.settings);
  return detectScheduleConflicts(papers, roomSlots, timeZone);
}
