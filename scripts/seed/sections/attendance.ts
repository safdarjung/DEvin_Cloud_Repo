import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES, sectionKey, sectionNames } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";

// 05 §8 / §8.1 — 60 school days (Mon-Fri + 2nd/4th Saturday of the month)
// from 2026-08-08 through 2026-10-28, skipping holidays, for every section:
// one submitted attendance_sessions row, one attendance_records row per
// student (92% P, 6% A, 1% L, 1% OL), and one correction per 2,000 records.
// The window ends 2026-10-28 (not 09-15) so the Nov demo dashboard has
// Sep-Oct data, while staying a day short of 2026-10-29 so today's (J-06)
// live session is deliberately not seeded here — both dates are fixed
// calendar dates, not derived from the real wall clock.

const HOLIDAYS = new Set(["2026-08-15", "2026-10-02", "2026-10-20", "2026-10-21", "2026-10-22"]);
const SCHOOL_DAY_COUNT = 60;
const BATCH_SIZE = 5000;

function isSecondOrFourthSaturday(date: Date): boolean {
  if (date.getUTCDay() !== 6) return false;
  const occurrence = Math.ceil(date.getUTCDate() / 7);
  return occurrence === 2 || occurrence === 4;
}

function schoolDays(count: number): string[] {
  const days: string[] = [];
  const cursor = new Date("2026-08-08T00:00:00Z");
  while (days.length < count) {
    const iso = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    const isWeekday = dow >= 1 && dow <= 5;
    if ((isWeekday || isSecondOrFourthSaturday(cursor)) && !HOLIDAYS.has(iso)) days.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Exported so db tests can bound their queries to the seeded window instead of scanning every row (09 §4 — reused, not re-derived). */
export const SCHOOL_DAYS = schoolDays(SCHOOL_DAY_COUNT);

/** code, cumulative probability upper bound (05 §4.1 statuses; HD unused here). */
const STATUS_DRAW: { code: string; upTo: number }[] = [
  { code: "P", upTo: 0.92 },
  { code: "A", upTo: 0.98 },
  { code: "L", upTo: 0.99 },
  { code: "OL", upTo: 1 },
];

function drawStatus(r: number): string {
  for (const { code, upTo } of STATUS_DRAW) if (r < upTo) return code;
  return "OL";
}

/** 05 §8.1 named-student attendance targets, hit deterministically (not via PRNG) within ±1%. */
const NAMED_TARGETS: { sectionKey: string; firstName: string; absentDayIndices: Set<number> }[] = [
  // 5/60 absent = 91.67% present (target 92%).
  { sectionKey: "VI-A", firstName: "Aarav", absentDayIndices: new Set([0, 12, 24, 36, 48]) },
  // 2/60 absent = 96.67% present (target 96%).
  { sectionKey: "X-A", firstName: "Ananya", absentDayIndices: new Set([0, 30]) },
  // 7/60 absent = 88.33% present (target 88%).
  { sectionKey: "VIII-B", firstName: "Ishaan", absentDayIndices: new Set([0, 9, 18, 27, 36, 45, 54]) },
];

export async function run(ctx: SeedContext): Promise<void> {
  const sections = GRADES.flatMap((grade) =>
    sectionNames(grade.code).map((name) => {
      const key = sectionKey(grade.code, name);
      return { key, id: uuidV5("academics", `section:${key}`) };
    }),
  );

  const { data: classSections, error } = await ctx.admin
    .from("class_sections")
    .select("id, class_teacher_id")
    .eq("institution_id", ctx.institutionId);
  if (error) throw new Error(`attendance: class_sections query failed: ${error.message}`);
  const classTeacherIdBySectionId = new Map((classSections ?? []).map((row) => [row.id, row.class_teacher_id!]));

  // studentId -> absent day indices, for the 3 named students (05 §8.1).
  const overrideByStudentId = new Map<string, Set<number>>();
  for (const target of NAMED_TARGETS) {
    const student = ctx.studentsBySection[target.sectionKey]?.find((s) => s.firstName === target.firstName);
    if (student) overrideByStudentId.set(student.id, target.absentDayIndices);
  }

  const sessionRows: Record<string, unknown>[] = [];
  const recordRows: Record<string, unknown>[] = [];
  const correctionRows: Record<string, unknown>[] = [];
  let recordCounter = 0;
  const lastDayIndex = SCHOOL_DAYS.length - 1;

  for (const section of sections) {
    const classTeacherId = classTeacherIdBySectionId.get(section.id) ?? null;
    const students = ctx.studentsBySection[section.key] ?? [];

    SCHOOL_DAYS.forEach((date, dayIndex) => {
      const sessionId = uuidV5("attendance", `session:${section.key}:${date}`);
      sessionRows.push({
        id: sessionId,
        institution_id: ctx.institutionId,
        class_section_id: section.id,
        date,
        status: "submitted",
        marked_by: classTeacherId,
        submitted_at: `${date}T15:30:00+05:30`,
      });

      const dayStatuses = students.map((student) => {
        const override = overrideByStudentId.get(student.id);
        if (override) return override.has(dayIndex) ? "A" : "P";
        return drawStatus(ctx.rng());
      });

      // AC2: the latest day must show at least one absence per section (J-06
      // needs data); force it on a non-overridden student if the draw missed.
      if (dayIndex === lastDayIndex && !dayStatuses.includes("A")) {
        const flipIndex = students.findIndex((student) => !overrideByStudentId.has(student.id));
        if (flipIndex >= 0) dayStatuses[flipIndex] = "A";
      }

      students.forEach((student, idx) => {
        const status = dayStatuses[idx]!;
        const recordId = uuidV5("attendance", `record:${sessionId}:${student.id}`);
        recordRows.push({
          id: recordId,
          institution_id: ctx.institutionId,
          session_id: sessionId,
          student_id: student.id,
          status,
        });

        recordCounter += 1;
        if (recordCounter % 2000 === 0) {
          const oldStatus = status === "P" ? "A" : "P";
          correctionRows.push({
            id: uuidV5("attendance", `correction:${recordId}`),
            institution_id: ctx.institutionId,
            record_id: recordId,
            old_status: oldStatus,
            new_status: status,
            reason: "Corrected after periodic register review.",
            corrected_by: classTeacherId,
          });
        }
      });
    });
  }

  await insertBatch(ctx.admin, "attendance_sessions", sessionRows, BATCH_SIZE);
  await insertBatch(ctx.admin, "attendance_records", recordRows, BATCH_SIZE);
  await insertBatch(ctx.admin, "attendance_corrections", correctionRows, BATCH_SIZE);
}
