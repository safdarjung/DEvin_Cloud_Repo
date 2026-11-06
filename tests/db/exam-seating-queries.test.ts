// X06-T6 — examSeating.slots / .chart / .studentSeats queries, exercised as
// the registered defineQuery actions (callAs), same shape as
// tests/db/exam-schedule-queries.test.ts. Fixtures seat students via the
// real `generate_seating_plan` RPC (T3) — the TS action (T5) isn't built
// yet, out of scope here.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import {
  examSeatingChartQuery,
  examSeatingSlotsQuery,
  examSeatingStudentSeatsQuery,
} from "@/modules/exam-seating/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

/** Supabase-js renders a fetched timestamptz as "...+00:00", not the "Z"-suffixed literal a test wrote — compare by instant, not by string. */
function atSlot<T extends { slotStart: string }>(rows: T[], iso: string): T | undefined {
  return rows.find((r) => new Date(r.slotStart).getTime() === new Date(iso).getTime());
}

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const FUTURE_SLOT_1 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const FUTURE_SLOT_2 = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createRoom(
  institutionId: string,
  overrides: Partial<{ name: string; capacity: number }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.rooms (institution_id, name, capacity)
    values (${institutionId}, ${overrides.name ?? `Room-${crypto.randomUUID().slice(0, 6)}`}, ${overrides.capacity ?? 30})
    returning id
  `;
  return row.id as string;
}

async function createExam(institutionId: string, termId: string): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (
      ${institutionId},
      (select academic_year_id from public.terms where id = ${termId}),
      ${termId},
      ${`Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test',
      'draft'
    )
    returning id
  `;
  return row.id as string;
}

async function insertExamPaper(
  institutionId: string,
  examId: string,
  classSectionId: string,
  subjectId: string,
  scheduledAt: string,
): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, scheduled_at, duration_minutes)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, 100, 33, ${scheduledAt}, 60)
    returning id
  `;
  return row.id as string;
}

async function membershipGuardianId(institutionId: string, userId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}`;
  return row.guardian_id as string;
}

async function linkGuardian(institutionId: string, guardianId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father')
  `;
}

/** Same as T2/T3's cleanup: the "one current row" invariant is a plain partial unique index, not a deferrable trigger — clear oldest-version-first before demo_reset-style teardown. */
async function cleanupSeatingFixture(institutionId: string): Promise<void> {
  await sql`delete from public.exam_seats where institution_id = ${institutionId}`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId} and superseded_by is not null`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId}`;
}

describe("examSeating.slots / .chart / .studentSeats (X06-T6)", () => {
  it("slots lists two slots with section labels; plan null before generation, set after; stale after a new enrolment", async () => {
    const inst = await createTestInstitution("seating-slots");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const grade6 = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
      const grade7 = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
      const section6 = await createClassSection(inst.institutionId, grade6, yearId, { name: "A" });
      const section7 = await createClassSection(inst.institutionId, grade7, yearId, { name: "A" });
      const examId = await createExam(inst.institutionId, termId);
      await insertExamPaper(inst.institutionId, examId, section6, subjectId, FUTURE_SLOT_1);
      await insertExamPaper(inst.institutionId, examId, section7, subjectId, FUTURE_SLOT_2);

      for (let i = 1; i <= 3; i++) {
        const studentId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
        await createEnrolment(inst.institutionId, studentId, section6, yearId, { rollNo: i });
      }
      const room1 = await createRoom(inst.institutionId, { capacity: 10 });

      const before = await callAs(inst, "exam_controller", examSeatingSlotsQuery, { examId });
      expect(before.ok).toBe(true);
      if (!before.ok) throw new Error("unreachable");
      expect(before.data).toHaveLength(2);
      const slot1Before = atSlot(before.data, FUTURE_SLOT_1);
      const slot2Before = atSlot(before.data, FUTURE_SLOT_2);
      expect(slot1Before?.sections).toEqual([{ id: section6, label: "VI-A" }]);
      expect(slot2Before?.sections).toEqual([{ id: section7, label: "VII-A" }]);
      expect(slot1Before?.plan).toBeNull();
      expect(slot2Before?.plan).toBeNull();

      const gen = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT_1,
        p_rooms: [{ room_id: room1 }],
      });
      expect(gen.error).toBeNull();

      const after = await callAs(inst, "exam_controller", examSeatingSlotsQuery, { examId });
      expect(after.ok).toBe(true);
      if (!after.ok) throw new Error("unreachable");
      const slot1After = atSlot(after.data, FUTURE_SLOT_1);
      expect(slot1After?.plan).toMatchObject({ versionNo: 1, seatCount: 3, stale: false });
      const slot2After = atSlot(after.data, FUTURE_SLOT_2);
      expect(slot2After?.plan).toBeNull();

      // A 4th student enrolled after generation makes the plan stale
      // (seat_count 3 != today's active student count 4).
      const extraStudent = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
      await createEnrolment(inst.institutionId, extraStudent, section6, yearId, { rollNo: 4 });

      const afterEnrol = await callAs(inst, "exam_controller", examSeatingSlotsQuery, { examId });
      expect(afterEnrol.ok).toBe(true);
      if (!afterEnrol.ok) throw new Error("unreachable");
      const slot1Stale = atSlot(afterEnrol.data, FUTURE_SLOT_1);
      expect(slot1Stale?.plan?.stale).toBe(true);
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("chart groups rooms in plan order with roll nos and section labels", async () => {
    const inst = await createTestInstitution("seating-chart");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const grade = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
      const section = await createClassSection(inst.institutionId, grade, yearId, { name: "A" });
      const examId = await createExam(inst.institutionId, termId);
      await insertExamPaper(inst.institutionId, examId, section, subjectId, FUTURE_SLOT_1);

      for (let i = 1; i <= 4; i++) {
        const studentId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
        await createEnrolment(inst.institutionId, studentId, section, yearId, { rollNo: i });
      }

      const room1 = await createRoom(inst.institutionId, { name: "Hall A", capacity: 2 });
      const room2 = await createRoom(inst.institutionId, { name: "Room 12", capacity: 2 });

      const gen = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT_1,
        p_rooms: [{ room_id: room1 }, { room_id: room2 }],
      });
      expect(gen.error).toBeNull();

      const chart = await callAs(inst, "exam_controller", examSeatingChartQuery, { planId: gen.data.id });
      expect(chart.ok).toBe(true);
      if (!chart.ok) throw new Error("unreachable");
      expect(chart.data).not.toBeNull();
      expect(chart.data?.rooms.map((r) => r.room.name)).toEqual(["Hall A", "Room 12"]);
      expect(chart.data?.rooms[0].seats).toHaveLength(2);
      expect(chart.data?.rooms[1].seats).toHaveLength(2);
      for (const room of chart.data?.rooms ?? []) {
        for (const seat of room.seats) {
          expect(seat.sectionLabel).toBe("VI-A");
          expect(typeof seat.rollNo).toBe("number");
        }
      }
      expect(chart.data?.isCurrent).toBe(true);
      expect(chart.data?.versionNo).toBe(1);
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("guardian studentSeats: own child's current seat only, not another family's, not a superseded version; teacher forbidden", async () => {
    const inst = await createTestInstitution("seating-student-seats");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const grade = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
      const section = await createClassSection(inst.institutionId, grade, yearId, { name: "A" });
      const examId = await createExam(inst.institutionId, termId);
      await insertExamPaper(inst.institutionId, examId, section, subjectId, FUTURE_SLOT_1);

      const guardianChildId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
      const otherChildId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
      await createEnrolment(inst.institutionId, guardianChildId, section, yearId, { rollNo: 1 });
      await createEnrolment(inst.institutionId, otherChildId, section, yearId, { rollNo: 2 });
      const guardianId = await membershipGuardianId(inst.institutionId, inst.users.guardian.id);
      await linkGuardian(inst.institutionId, guardianId, guardianChildId);

      const room1 = await createRoom(inst.institutionId, { capacity: 10 });

      const gen1 = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT_1,
        p_rooms: [{ room_id: room1 }],
      });
      expect(gen1.error).toBeNull();

      const ownSeats = await callAs(inst, "guardian", examSeatingStudentSeatsQuery, { studentId: guardianChildId });
      expect(ownSeats.ok).toBe(true);
      if (!ownSeats.ok) throw new Error("unreachable");
      expect(ownSeats.data).toHaveLength(1);
      expect(ownSeats.data[0]).toMatchObject({
        studentId: guardianChildId,
        planId: gen1.data.id,
        room: { id: room1 },
      });

      const otherSeats = await callAs(inst, "guardian", examSeatingStudentSeatsQuery, { studentId: otherChildId });
      expect(otherSeats.ok).toBe(true);
      if (!otherSeats.ok) throw new Error("unreachable");
      expect(otherSeats.data).toEqual([]);

      // Regenerate: v1 superseded by v2. Guardian still sees exactly one
      // (current) row — the superseded version never reaches them.
      const gen2 = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT_1,
        p_rooms: [{ room_id: room1 }],
      });
      expect(gen2.error).toBeNull();

      const afterRegen = await callAs(inst, "guardian", examSeatingStudentSeatsQuery, { studentId: guardianChildId });
      expect(afterRegen.ok).toBe(true);
      if (!afterRegen.ok) throw new Error("unreachable");
      expect(afterRegen.data).toHaveLength(1);
      expect(afterRegen.data[0].planId).toBe(gen2.data.id);

      const teacherResult = await callAs(inst, "teacher", examSeatingStudentSeatsQuery, { studentId: guardianChildId });
      expect(teacherResult.ok).toBe(false);
      if (teacherResult.ok) throw new Error("unreachable");
      expect(teacherResult.error.code).toBe("forbidden");

      // Review finding (LOW, X06): guardian is also granted exam.seating.read.
      // getSeatingChart builds the room's seat list purely from whatever
      // exam_seats rows RLS returns, so a guardian sees the room with only
      // their own child's seat, not the other child seated in the same room.
      // Intentional (no cross-student leak) — pinned here so it stays that way.
      const guardianChart = await callAs(inst, "guardian", examSeatingChartQuery, { planId: gen2.data.id });
      expect(guardianChart.ok).toBe(true);
      if (!guardianChart.ok) throw new Error("unreachable");
      expect(guardianChart.data?.rooms).toHaveLength(1);
      expect(guardianChart.data?.rooms[0].seats).toEqual([
        expect.objectContaining({ studentId: guardianChildId }),
      ]);
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });
});
