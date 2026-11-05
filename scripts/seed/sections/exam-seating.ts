import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES, sectionKey, sectionNames } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";

// X06-T10 — draft exam "Unit Test 3" (unit_test) with papers for every
// section of the demo guardian's child's grade (Aarav Sharma, VI-A — 05
// §8.1) and the next grade up (VII): 2 subjects/section, one at each of two
// slots (first Monday >= run day + 14, and the day after, 09:30 IST, 60
// min). Rulings: dates are relative to the run day (a fixed date would
// become a past slot and break every later reseed); ids stay fixed
// (uuidV5), so no ctx.rng draw is used here — this section must never shift
// the shared PRNG's draw order for sections that run after it (website.ts).
// Only the first slot is planned via generate_seating_plan (rooms = the
// hall then classrooms by name until seats >= students); the second slot
// stays unplanned ("To be announced" on admit cards).

const EXAM_ID = uuidV5("exam_seating", "exam:unit-test-3");
const SLOT_MINUTES = 60;
const MAX_MARKS = 40;
const PASS_MARKS = 13;

function firstMondayAtLeast(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + ((1 - day + 7) % 7));
  return d;
}

function istDateTime(date: Date, time: string): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T${time}+05:30`;
}

export async function run(ctx: SeedContext): Promise<void> {
  const { data: existing } = await ctx.admin.from("exams").select("id").eq("id", EXAM_ID).maybeSingle();
  if (existing) return; // idempotent rerun guard (exams.ts precedent)

  const runDayPlus14 = new Date();
  runDayPlus14.setUTCDate(runDayPlus14.getUTCDate() + 14);
  const slot1Date = firstMondayAtLeast(runDayPlus14);
  const slot2Date = new Date(slot1Date);
  slot2Date.setUTCDate(slot2Date.getUTCDate() + 1);
  const slot1 = istDateTime(slot1Date, "09:30:00");
  const slot2 = istDateTime(slot2Date, "09:30:00");

  // ---- term: whichever of the two seeded terms' date range holds slot1 (fallback term2) ----
  const { data: termRows, error: termError } = await ctx.admin
    .from("terms")
    .select("id, starts_on, ends_on")
    .in("id", [ctx.termIds.term1, ctx.termIds.term2]);
  if (termError) throw new Error(`exam-seating: terms query failed: ${termError.message}`);
  const slot1Day = slot1.slice(0, 10);
  const termId =
    (termRows ?? []).find((t) => (t.starts_on as string) <= slot1Day && slot1Day <= (t.ends_on as string))?.id ??
    ctx.termIds.term2;

  // ---- target sections: VI + VII (demo guardian's child Aarav Sharma is in VI-A, 05 §8.1) ----
  const sectionKeysFor = (code: string) => sectionNames(code).map((name) => sectionKey(code, name));
  const targetSectionKeys = [...sectionKeysFor("VI"), ...sectionKeysFor("VII")];
  const targetSectionIds = targetSectionKeys.map((key) => uuidV5("academics", `section:${key}`));

  // ---- 2 subjects/section from subject_assignments, by subject code (deterministic) ----
  const { data: assignmentRows, error: assignmentError } = await ctx.admin
    .from("subject_assignments")
    .select("class_section_id, subject_id")
    .eq("institution_id", ctx.institutionId)
    .in("class_section_id", targetSectionIds);
  if (assignmentError) throw new Error(`exam-seating: subject_assignments query failed: ${assignmentError.message}`);
  const { data: subjectRows, error: subjectError } = await ctx.admin
    .from("subjects")
    .select("id, code")
    .eq("institution_id", ctx.institutionId);
  if (subjectError) throw new Error(`exam-seating: subjects query failed: ${subjectError.message}`);
  const subjectCodeById = new Map((subjectRows ?? []).map((s) => [s.id, s.code as string]));

  const subjectsBySection = new Map<string, { subjectId: string; code: string }[]>();
  for (const a of assignmentRows ?? []) {
    const code = subjectCodeById.get(a.subject_id);
    if (!code) continue;
    const list = subjectsBySection.get(a.class_section_id) ?? [];
    list.push({ subjectId: a.subject_id, code });
    subjectsBySection.set(a.class_section_id, list);
  }
  for (const list of subjectsBySection.values()) list.sort((x, y) => x.code.localeCompare(y.code));

  await ctx.admin.from("exams").insert({
    id: EXAM_ID,
    institution_id: ctx.institutionId,
    academic_year_id: ctx.academicYearId,
    term_id: termId,
    name: "Unit Test 3",
    type: "unit_test",
    status: "draft",
    grading_scale_key: "default",
  });

  const paperRows: Record<string, unknown>[] = [];
  for (const sectionId of targetSectionIds) {
    const subjects = subjectsBySection.get(sectionId) ?? [];
    const [first, second] = subjects;
    if (!first || !second) {
      throw new Error(`exam-seating: section ${sectionId} has fewer than 2 subject_assignments`);
    }
    for (const [subject, scheduledAt] of [
      [first, slot1],
      [second, slot2],
    ] as const) {
      paperRows.push({
        id: uuidV5("exam_seating", `paper:${sectionId}:${subject.subjectId}`),
        institution_id: ctx.institutionId,
        exam_id: EXAM_ID,
        class_section_id: sectionId,
        subject_id: subject.subjectId,
        max_marks: MAX_MARKS,
        pass_marks: PASS_MARKS,
        scheduled_at: scheduledAt,
        duration_minutes: SLOT_MINUTES,
        room_id: null,
      });
    }
  }
  await insertBatch(ctx.admin, "exam_papers", paperRows);

  // ---- rooms: the hall, then classrooms by name, until seats >= students ----
  const hall = { id: uuidV5("timetable", "room:hall"), name: "Hall", capacity: 300 };
  const classrooms = GRADES.flatMap((grade) =>
    sectionNames(grade.code).map((name) => {
      const key = sectionKey(grade.code, name);
      return { id: uuidV5("timetable", `room:${key}`), name: `Room ${key}`, capacity: 45 };
    }),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const totalStudents = targetSectionKeys.reduce(
    (sum, key) => sum + (ctx.studentsBySection[key]?.length ?? 0),
    0,
  );
  const rooms: { room_id: string; seats: number }[] = [];
  let seatsSoFar = 0;
  for (const room of [hall, ...classrooms]) {
    rooms.push({ room_id: room.id, seats: room.capacity });
    seatsSoFar += room.capacity;
    if (seatsSoFar >= totalStudents) break;
  }

  const { error: generateError } = await ctx.admin.rpc("generate_seating_plan", {
    p_institution_id: ctx.institutionId,
    p_exam_id: EXAM_ID,
    p_slot_start: slot1,
    p_rooms: rooms,
  });
  if (generateError) throw new Error(`exam-seating: generate_seating_plan failed: ${generateError.message}`);
}
