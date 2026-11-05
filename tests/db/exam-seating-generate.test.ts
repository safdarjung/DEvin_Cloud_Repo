// X06-T3 — migration 0088 part B: app.generate_seating_plan / public RPC.
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const FUTURE_SLOT = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const PAST_SLOT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createRoom(institutionId: string, overrides: Partial<{ name: string; capacity: number }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.rooms (institution_id, name, capacity)
    values (${institutionId}, ${overrides.name ?? `Room-${crypto.randomUUID().slice(0, 6)}`}, ${overrides.capacity ?? 30})
    returning id
  `;
  return row.id as string;
}

async function createExam(
  institutionId: string,
  termId: string,
  overrides: Partial<{ status: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (
      ${institutionId},
      (select academic_year_id from public.terms where id = ${termId}),
      ${termId},
      ${`Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test',
      ${overrides.status ?? "draft"}
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

/**
 * One section of `studentCount` active students (roll_no 1..n), enrolled
 * for an exam paper at `slotStart`.
 */
async function seedSection(
  institutionId: string,
  gradeId: string,
  yearId: string,
  examId: string,
  subjectId: string,
  slotStart: string,
  sectionName: string,
  studentCount: number,
): Promise<string> {
  const sectionId = await createClassSection(institutionId, gradeId, yearId, { name: sectionName });
  await insertExamPaper(institutionId, examId, sectionId, subjectId, slotStart);
  for (let i = 1; i <= studentCount; i++) {
    const studentId = await insertStudent(institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
    await createEnrolment(institutionId, studentId, sectionId, yearId, { rollNo: i });
  }
  return sectionId;
}

/**
 * demo_reset (0001) nulls every self-referencing FK column generically
 * before deleting rows; exam_seating_plans' "one current row" invariant is
 * a plain partial unique INDEX (not a deferrable constraint trigger, see
 * T2's exam-seating-rls.test.ts), so nulling a superseded row's
 * superseded_by mid-reset collides with the already-current row whenever a
 * test leaves more than one version behind. Clear this module's own rows
 * first (oldest-version-first) to avoid it.
 */
async function cleanupSeatingFixture(institutionId: string): Promise<void> {
  await sql`delete from public.exam_seats where institution_id = ${institutionId}`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId} and superseded_by is not null`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId}`;
}

describe("app.generate_seating_plan (X06-T3)", () => {
  it("seats grade-6 and grade-7 sections into 2 rooms, interleaved; regenerate is deterministic", async () => {
    const inst = await createTestInstitution("gen-happy");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const grade6 = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
      const grade7 = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
      const examId = await createExam(inst.institutionId, termId);

      await seedSection(inst.institutionId, grade6, yearId, examId, subjectId, FUTURE_SLOT, "A", 5);
      await seedSection(inst.institutionId, grade7, yearId, examId, subjectId, FUTURE_SLOT, "A", 5);

      const room1 = await createRoom(inst.institutionId, { capacity: 6 });
      const room2 = await createRoom(inst.institutionId, { capacity: 6 });

      const gen1 = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: room1 }, { room_id: room2 }],
      });
      expect(gen1.error).toBeNull();
      expect(gen1.data.seat_count).toBe(10);
      expect(gen1.data.version_no).toBe(1);

      const seats1 = await sql`
        select student_id, class_section_id, room_id, seat_no
        from public.exam_seats where plan_id = ${gen1.data.id} order by room_id, seat_no
      `;
      expect(seats1).toHaveLength(10);
      // seats 1 and 2 of room1 (plan room order) come from different grades/sections.
      const room1Seats = seats1.filter((r) => r.room_id === room1).sort((a, b) => a.seat_no - b.seat_no);
      expect(room1Seats[0].class_section_id).not.toBe(room1Seats[1].class_section_id);

      // Regenerate: version 2, v1 superseded by v2, exactly one current row.
      const gen2 = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: room1 }, { room_id: room2 }],
      });
      expect(gen2.error).toBeNull();
      expect(gen2.data.version_no).toBe(2);

      const [v1Row] = await sql`select superseded_by from public.exam_seating_plans where id = ${gen1.data.id}`;
      expect(v1Row.superseded_by).toBe(gen2.data.id);

      const currentRows = await sql`
        select id from public.exam_seating_plans
        where exam_id = ${examId} and slot_start = ${FUTURE_SLOT} and superseded_by is null
      `;
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0].id).toBe(gen2.data.id);

      // Same inputs -> identical (student, room, seat_no) set.
      const seats2 = await sql`
        select student_id, room_id, seat_no from public.exam_seats where plan_id = ${gen2.data.id}
      `;
      const key = (r: { student_id?: unknown; room_id?: unknown; seat_no?: unknown }) => `${r.student_id}:${r.room_id}:${r.seat_no}`;
      expect(seats2.map(key).sort()).toEqual(seats1.map(key).sort());
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("11 students into 10 seats is a conflict", async () => {
    const inst = await createTestInstitution("gen-conflict");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const grade = await createGrade(inst.institutionId);
      const examId = await createExam(inst.institutionId, termId);
      await seedSection(inst.institutionId, grade, yearId, examId, subjectId, FUTURE_SLOT, "A", 11);

      const room1 = await createRoom(inst.institutionId, { capacity: 5 });
      const room2 = await createRoom(inst.institutionId, { capacity: 5 });

      const gen = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: room1 }, { room_id: room2 }],
      });
      expect(gen.error?.message).toBe("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("validation_failed: seats over room capacity, another institution's room, duplicate room", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearId = await createAcademicYear(instA.institutionId);
      const termId = await createTerm(instA.institutionId, yearId);
      const subjectId = await createSubject(instA.institutionId);
      const grade = await createGrade(instA.institutionId);
      const examId = await createExam(instA.institutionId, termId);
      await seedSection(instA.institutionId, grade, yearId, examId, subjectId, FUTURE_SLOT, "A", 2);

      const roomA = await createRoom(instA.institutionId, { capacity: 5 });
      const roomB = await createRoom(instB.institutionId, { capacity: 5 });

      const overCapacity = await instA.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: instA.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: roomA, seats: 10 }],
      });
      expect(overCapacity.error?.message).toBe("code:validation_failed");

      const otherInstitutionRoom = await instA.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: instA.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: roomB }],
      });
      expect(otherInstitutionRoom.error?.message).toBe("code:validation_failed");

      const duplicateRoom = await instA.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: instA.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: roomA }, { room_id: roomA }],
      });
      expect(duplicateRoom.error?.message).toBe("code:validation_failed");

      // Review finding (LOW, X06): a non-uuid room_id or non-numeric seats
      // must raise code:validation_failed, not an unhandled cast error.
      const malformedRoomId = await instA.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: instA.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: "not-a-uuid" }],
      });
      expect(malformedRoomId.error?.message).toBe("code:validation_failed");

      const malformedSeats = await instA.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: instA.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: roomA, seats: "ten" }],
      });
      expect(malformedSeats.error?.message).toBe("code:validation_failed");
    });
  });

  it("past slot is invalid_state; published exam is invalid_state; no paper at slot is not_found", async () => {
    const inst = await createTestInstitution("gen-state");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const grade = await createGrade(inst.institutionId);
      const room = await createRoom(inst.institutionId, { capacity: 5 });

      const examId = await createExam(inst.institutionId, termId);
      await seedSection(inst.institutionId, grade, yearId, examId, subjectId, FUTURE_SLOT, "A", 2);

      const pastSlot = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: PAST_SLOT,
        p_rooms: [{ room_id: room }],
      });
      expect(pastSlot.error?.message).toBe("code:invalid_state");

      const noPaper = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
        p_rooms: [{ room_id: room }],
      });
      expect(noPaper.error?.message).toBe("code:not_found");

      const publishedExamId = await createExam(inst.institutionId, termId, { status: "published" });
      await seedSection(inst.institutionId, grade, yearId, publishedExamId, subjectId, FUTURE_SLOT, "B", 2);
      const published = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: publishedExamId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: room }],
      });
      expect(published.error?.message).toBe("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin and teacher are forbidden; another institution's exam id is not_found", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearId = await createAcademicYear(instA.institutionId);
      const termId = await createTerm(instA.institutionId, yearId);
      const subjectId = await createSubject(instA.institutionId);
      const grade = await createGrade(instA.institutionId);
      const room = await createRoom(instA.institutionId, { capacity: 5 });
      const examId = await createExam(instA.institutionId, termId);
      await seedSection(instA.institutionId, grade, yearId, examId, subjectId, FUTURE_SLOT, "A", 2);

      for (const role of ["admin", "teacher"] as const) {
        const attempt = await instA.clientAs(role).rpc("generate_seating_plan", {
          p_institution_id: instA.institutionId,
          p_exam_id: examId,
          p_slot_start: FUTURE_SLOT,
          p_rooms: [{ room_id: room }],
        });
        expect(attempt.error?.message).toBe("code:forbidden");
      }

      const bYearId = await createAcademicYear(instB.institutionId);
      const bTermId = await createTerm(instB.institutionId, bYearId);
      const bExamId = await createExam(instB.institutionId, bTermId);

      const crossInstitution = await instA.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: instA.institutionId,
        p_exam_id: bExamId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: room }],
      });
      expect(crossInstitution.error?.message).toBe("code:not_found");
    });
  });

  it("service_role call produces a plan with generated_by null and an ids/counts-only audit row", async () => {
    const inst = await createTestInstitution("gen-service");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const grade = await createGrade(inst.institutionId);
      const examId = await createExam(inst.institutionId, termId);
      await seedSection(inst.institutionId, grade, yearId, examId, subjectId, FUTURE_SLOT, "A", 2);
      const room = await createRoom(inst.institutionId, { capacity: 5 });

      const serviceClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SECRET_KEY as string,
      );
      const gen = await serviceClient.rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT,
        p_rooms: [{ room_id: room }],
      });
      expect(gen.error).toBeNull();
      expect(gen.data.generated_by).toBeNull();

      const [audit] = await sql`
        select metadata from public.audit_events
        where action = 'exam.seating.generated' and entity_id = ${gen.data.id}
      `;
      expect(audit.metadata).toMatchObject({
        plan_id: gen.data.id,
        exam_id: examId,
        version_no: 1,
        seat_count: 2,
      });
    } finally {
      await inst.cleanup();
    }
  });
});
