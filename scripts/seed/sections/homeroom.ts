import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// X01-T12 (X01-tasks.md Task 12) — student leave requests + class diary for
// the demo tenant. Dates are relative to the run date (not fixed, like
// staffing.ts's leave/attendance), so the live demo always has a pending
// leave and an unacknowledged diary note waiting "today". No attendance
// rows are written or changed here: the approved leave below predates
// attendance.ts's 2026-07-01 seeded window, so there's nothing to
// pre-mark, and this section never calls app.premark_student_leave itself
// (that only runs inside decide_student_leave, never from a seed script).

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** ISO weekday: Mon=1 ... Sun=7 (matches extract(isodow ...)). */
function isodow(iso: string): number {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** d0 = today (Asia/Kolkata) if Mon-Sat, else the next Monday. */
function computeD0(): string {
  const today = todayIST();
  return isodow(today) <= 6 ? today : addDays(today, 1);
}

function nextSchoolDay(iso: string): string {
  let cursor = addDays(iso, 1);
  while (isodow(cursor) === 7) cursor = addDays(cursor, 1);
  return cursor;
}

function previousSchoolDay(iso: string): string {
  let cursor = addDays(iso, -1);
  while (isodow(cursor) === 7) cursor = addDays(cursor, -1);
  return cursor;
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

// Same 3 named sections/class teachers as academics.ts's
// NAMED_CLASS_TEACHER_LOGIN (05 §8.1).
const SECTION_TEACHER_LOGIN: Record<string, string> = {
  "VI-A": "teacher.vi-a",
  "VIII-B": "teacher.viii-b",
  "X-A": "teacher.x-a",
};

const PTM_NOTE_BODY = "Parent-teacher meeting on Saturday at 10 am. Please acknowledge.";

export async function run(ctx: SeedContext): Promise<void> {
  const d0 = computeD0();
  const d1 = nextSchoolDay(d0);
  const prevSchoolDay = previousSchoolDay(d0);
  const pastSchoolDay = addDays(d0, -7); // same weekday as d0, so guaranteed Mon-Sat.

  const principalUserId = ctx.userIdByLogin["principal"]!;

  const viAStudents = ctx.studentsBySection["VI-A"] ?? [];
  const viiiBStudents = ctx.studentsBySection["VIII-B"] ?? [];
  const aarav = viAStudents.find((s) => s.firstName === "Aarav");
  const ishaan = viiiBStudents.find((s) => s.firstName === "Ishaan");
  const nonNamedViAStudent = viAStudents.find((s) => s.firstName !== "Aarav");
  if (!aarav) throw new Error("homeroom: Aarav not found in VI-A");
  if (!ishaan) throw new Error("homeroom: Ishaan not found in VIII-B");
  if (!nonNamedViAStudent) throw new Error("homeroom: no non-named VI-A student found");

  const sectionIdByKey: Record<string, string> = {};
  for (const key of Object.keys(SECTION_TEACHER_LOGIN)) {
    sectionIdByKey[key] = uuidV5("academics", `section:${key}`);
  }

  // ---- student_leave_requests (service role bypasses
  // guard_student_leave_requests, so status/class_section_id/created_by/
  // decided_by/decided_at are set explicitly) ----
  const leaveRows: Record<string, unknown>[] = [
    {
      id: uuidV5("homeroom", "leave:aarav"),
      institution_id: ctx.institutionId,
      student_id: aarav.id,
      class_section_id: sectionIdByKey["VI-A"],
      start_date: d1,
      end_date: d1,
      reason: "Family function",
      status: "pending",
      created_by: ctx.userIdByLogin["guardian.one"]!,
      decided_by: null,
      decided_at: null,
      decision_note: null,
      created_at: hoursAgoIso(3),
    },
    {
      id: uuidV5("homeroom", "leave:ishaan"),
      institution_id: ctx.institutionId,
      student_id: ishaan.id,
      class_section_id: sectionIdByKey["VIII-B"],
      start_date: pastSchoolDay,
      end_date: pastSchoolDay,
      reason: "Doctor's appointment",
      status: "rejected",
      created_by: ctx.userIdByLogin["guardian.two"]!,
      decided_by: ctx.userIdByLogin["teacher.viii-b"]!,
      decided_at: `${addDays(pastSchoolDay, -1)}T09:00:00+05:30`,
      decision_note: null,
      created_at: `${addDays(pastSchoolDay, -2)}T08:00:00+05:30`,
    },
    {
      id: uuidV5("homeroom", "leave:vi-a-approved"),
      institution_id: ctx.institutionId,
      student_id: nonNamedViAStudent.id,
      class_section_id: sectionIdByKey["VI-A"],
      start_date: "2026-06-15",
      end_date: "2026-06-16",
      reason: "Family travel",
      status: "approved",
      created_by: principalUserId,
      decided_by: ctx.userIdByLogin["teacher.vi-a"]!,
      decided_at: "2026-06-10T09:00:00+05:30",
      decision_note: null,
      created_at: "2026-06-08T08:00:00+05:30",
    },
  ];
  await insertBatch(ctx.admin, "student_leave_requests", leaveRows);

  // ---- diary_entries: 2 subject homework entries (from the section's
  // subject_assignments) on prevSchoolDay and on d0, plus one general PTM
  // note on d0 (05 §8.1's PTM Saturday). 5 rows/section x 3 sections = 15. ----
  const diaryRows: Record<string, unknown>[] = [];
  let viiiBNoteEntryId: string | undefined;

  for (const [key, teacherLogin] of Object.entries(SECTION_TEACHER_LOGIN)) {
    const sectionId = sectionIdByKey[key]!;
    const createdBy = ctx.userIdByLogin[teacherLogin]!;

    const { data: assignments, error } = await ctx.admin
      .from("subject_assignments")
      .select("subject_id, subjects(name)")
      .eq("institution_id", ctx.institutionId)
      .eq("class_section_id", sectionId)
      .order("subject_id")
      .limit(2);
    if (error) throw new Error(`homeroom: subject_assignments query failed for ${key}: ${error.message}`);
    if (!assignments || assignments.length < 2) {
      throw new Error(`homeroom: ${key} has fewer than 2 subject_assignments`);
    }

    for (const entryDate of [prevSchoolDay, d0]) {
      for (const [slot, assignment] of assignments.entries()) {
        const subjectId = assignment.subject_id as string;
        const subjectName = (assignment.subjects as { name: string } | null)?.name ?? "the subject";
        diaryRows.push({
          id: uuidV5("homeroom", `diary:${key}:${entryDate}:hw${slot + 1}`),
          institution_id: ctx.institutionId,
          class_section_id: sectionId,
          subject_id: subjectId,
          entry_date: entryDate,
          body: `${subjectName} homework: complete the exercises assigned in class.`,
          due_date: nextSchoolDay(entryDate),
          requires_ack: false,
          created_by: createdBy,
        });
      }
    }

    const noteId = uuidV5("homeroom", `diary:${key}:${d0}:note`);
    diaryRows.push({
      id: noteId,
      institution_id: ctx.institutionId,
      class_section_id: sectionId,
      subject_id: null,
      entry_date: d0,
      body: PTM_NOTE_BODY,
      due_date: null,
      requires_ack: true,
      created_by: createdBy,
    });
    if (key === "VIII-B") viiiBNoteEntryId = noteId;
  }
  await insertBatch(ctx.admin, "diary_entries", diaryRows);

  // ---- diary_acknowledgements: guardian.two acknowledges Ishaan's PTM
  // note (guardian.one leaves Aarav's unacknowledged — the live demo step) ----
  if (!viiiBNoteEntryId) throw new Error("homeroom: VIII-B PTM note id not captured");
  await insertBatch(ctx.admin, "diary_acknowledgements", [
    {
      id: uuidV5("homeroom", "ack:viii-b-ishaan"),
      institution_id: ctx.institutionId,
      entry_id: viiiBNoteEntryId,
      student_id: ishaan.id,
      acknowledged_by: ctx.userIdByLogin["guardian.two"]!,
    },
  ]);
}
