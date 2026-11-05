import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES, sectionKey, sectionNames } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";

// M07-T6 (M07-tasks.md Task 6) — one dedicated room per section (capacity
// 45) + a hall, the bell schedule (7 teaching periods, one short break, one
// lunch break, 08:00–14:10 IST, 45-min periods, 15-min short break, 40-min
// lunch), and one published timetable version filling Mon-Sat for every
// section from its subject_assignments (academics.ts), greedy round-robin
// that skips a cell rather than ever double-book a teacher or room.

const WEEKDAYS = [1, 2, 3, 4, 5, 6];

// Bell schedule: 08:00–14:10 IST, 45-min periods, 15-min short break,
// 40-min lunch.
const SLOT_DEFS: { seq: number; name: string; start: string; end: string; isBreak: boolean }[] = [
  { seq: 1, name: "Period 1", start: "08:00", end: "08:45", isBreak: false },
  { seq: 2, name: "Period 2", start: "08:45", end: "09:30", isBreak: false },
  { seq: 3, name: "Period 3", start: "09:30", end: "10:15", isBreak: false },
  { seq: 4, name: "Short break", start: "10:15", end: "10:30", isBreak: true },
  { seq: 5, name: "Period 4", start: "10:30", end: "11:15", isBreak: false },
  { seq: 6, name: "Period 5", start: "11:15", end: "12:00", isBreak: false },
  { seq: 7, name: "Lunch", start: "12:00", end: "12:40", isBreak: true },
  { seq: 8, name: "Period 6", start: "12:40", end: "13:25", isBreak: false },
  { seq: 9, name: "Period 7", start: "13:25", end: "14:10", isBreak: false },
];

// Fixed, not wall-clock (05 §8 determinism contract) — inside the seeded
// academic year (academics.ts enrolments start 2026-04-01).
const PUBLISHED_AT = "2026-04-05T09:00:00+05:30";

export async function run(ctx: SeedContext): Promise<void> {
  const sections = GRADES.flatMap((grade) =>
    sectionNames(grade.code).map((name) => {
      const key = sectionKey(grade.code, name);
      return { key, id: uuidV5("academics", `section:${key}`) };
    }),
  );

  // ---- rooms: one per section (capacity 45) + a hall ----
  const roomIdBySectionKey: Record<string, string> = {};
  const roomRows: Record<string, unknown>[] = sections.map((section) => {
    const id = uuidV5("timetable", `room:${section.key}`);
    roomIdBySectionKey[section.key] = id;
    return { id, institution_id: ctx.institutionId, name: `Room ${section.key}`, capacity: 45, kind: "classroom" };
  });
  roomRows.push({
    id: uuidV5("timetable", "room:hall"),
    institution_id: ctx.institutionId,
    name: "Hall",
    capacity: 300,
    kind: "hall",
  });
  await insertBatch(ctx.admin, "rooms", roomRows);

  // ---- periods: the bell schedule ----
  const periodIdBySeq: Record<number, string> = {};
  const periodRows: Record<string, unknown>[] = SLOT_DEFS.map((slot) => {
    const id = uuidV5("timetable", `period:${slot.seq}`);
    periodIdBySeq[slot.seq] = id;
    return {
      id,
      institution_id: ctx.institutionId,
      seq: slot.seq,
      name: slot.name,
      starts_at: slot.start,
      ends_at: slot.end,
      is_break: slot.isBreak,
    };
  });
  await insertBatch(ctx.admin, "periods", periodRows);
  const teachingPeriods = SLOT_DEFS.filter((slot) => !slot.isBreak);

  // ---- version: draft first (slots are writable only while draft) ----
  const versionId = uuidV5("timetable", `version:${ctx.academicYearId}`);
  const creatorUserId = ctx.userIdByLogin["principal"]!;
  await ctx.admin.from("timetable_versions").insert({
    id: versionId,
    institution_id: ctx.institutionId,
    academic_year_id: ctx.academicYearId,
    name: "2026-27 Timetable",
    status: "draft",
    created_by: creatorUserId,
  });

  // ---- subject_assignments per section (teacher_id + subject_id pairs) ----
  const { data: assignments, error } = await ctx.admin
    .from("subject_assignments")
    .select("class_section_id, teacher_id, subject_id")
    .eq("institution_id", ctx.institutionId)
    .order("subject_id");
  if (error) throw new Error(`timetable: subject_assignments query failed: ${error.message}`);

  const assignmentsBySectionId = new Map<string, { teacherId: string; subjectId: string }[]>();
  for (const a of assignments ?? []) {
    const list = assignmentsBySectionId.get(a.class_section_id) ?? [];
    list.push({ teacherId: a.teacher_id, subjectId: a.subject_id });
    assignmentsBySectionId.set(a.class_section_id, list);
  }

  // ---- slots: greedy round-robin, Mon-Sat x teaching periods, skip a cell
  // rather than double-book a teacher. Rooms never collide (each section
  // only ever writes to its own dedicated room). Sections with fewer
  // subjects (e.g. the 5-subject senior-secondary streams) must repeat each
  // assignment more often per week to fill the grid, so they're the most
  // constrained — process them first, stable-sorted, so a shared teacher's
  // calendar fills around their tighter needs rather than the other way round.
  const busyTeacherSlots = new Set<string>(); // `${weekday}:${periodId}:${teacherId}`
  const slotRows: Record<string, unknown>[] = [];
  const sectionsByConstraint = [...sections].sort(
    (a, b) => (assignmentsBySectionId.get(a.id)?.length ?? Infinity) - (assignmentsBySectionId.get(b.id)?.length ?? Infinity),
  );

  for (const [sectionIndex, section] of sectionsByConstraint.entries()) {
    const assignmentList = assignmentsBySectionId.get(section.id) ?? [];
    if (assignmentList.length === 0) continue;
    const roomId = roomIdBySectionKey[section.key]!;
    // A teacher shared across several sections would otherwise get asked
    // for the same (weekday, period) by every one of them, since they'd
    // all compute the same rotation — this per-section phase (the
    // section's position in the processing order, not ctx.rng: that PRNG
    // is shared across every section in sequence and other sections
    // depend on its exact draw order) de-syncs the rotation so sharing a
    // teacher doesn't mean colliding.
    const sectionPhase = sectionIndex;

    for (const weekday of WEEKDAYS) {
      for (let periodIndex = 0; periodIndex < teachingPeriods.length; periodIndex++) {
        const period = teachingPeriods[periodIndex]!;
        const periodId = periodIdBySeq[period.seq]!;
        // Rotate by weekday + the section's phase so a subject doesn't
        // land on the same period every day, then round-robin through the
        // rest of the section's assignments (in that rotated order) for
        // the first one not already teaching elsewhere this
        // weekday/period — only skip the cell outright if every
        // assignment is busy.
        const start = (periodIndex + weekday + sectionPhase) % assignmentList.length;
        let chosen: { teacherId: string; subjectId: string } | undefined;
        for (let i = 0; i < assignmentList.length; i++) {
          const candidate = assignmentList[(start + i) % assignmentList.length]!;
          if (!busyTeacherSlots.has(`${weekday}:${periodId}:${candidate.teacherId}`)) {
            chosen = candidate;
            break;
          }
        }
        if (!chosen) continue;

        busyTeacherSlots.add(`${weekday}:${periodId}:${chosen.teacherId}`);
        slotRows.push({
          id: uuidV5("timetable", `slot:${section.key}:${weekday}:${period.seq}`),
          institution_id: ctx.institutionId,
          version_id: versionId,
          class_section_id: section.id,
          subject_id: chosen.subjectId,
          teacher_id: chosen.teacherId,
          room_id: roomId,
          weekday,
          period_id: periodId,
        });
      }
    }
  }

  await insertBatch(ctx.admin, "timetable_slots", slotRows, 5000);

  // ---- publish: direct update, service-role bypasses guard_timetable_versions_update ----
  const { error: publishError } = await ctx.admin
    .from("timetable_versions")
    .update({ status: "published", published_at: PUBLISHED_AT, published_by: creatorUserId })
    .eq("id", versionId);
  if (publishError) throw new Error(`timetable: publish failed: ${publishError.message}`);
}
