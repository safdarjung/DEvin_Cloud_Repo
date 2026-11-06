// X06-T2 — exam_seating_plans / exam_seats (migration 0088 part A) RLS.
// Fixture rows are written via the direct sql connection (service role,
// bypasses RLS) since T3's app.generate_seating_plan (the only writer
// through PostgREST) isn't built yet — out of scope here.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

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

async function createPlan(
  institutionId: string,
  examId: string,
  slotStart: string,
  versionNo: number,
  sectionIds: string[],
  seatCount: number,
): Promise<string> {
  const [row] = await sql`
    insert into public.exam_seating_plans (
      institution_id, exam_id, slot_start, version_no, exam_name, rooms, section_ids, seat_count
    )
    values (
      ${institutionId}, ${examId}, ${slotStart}, ${versionNo}, 'Mid Term',
      ${sql.json([{ room_id: null, seats: seatCount }])}, ${sectionIds}, ${seatCount}
    )
    returning id
  `;
  return row.id as string;
}

/**
 * Supersedes `oldPlanId` with a freshly-inserted next version, in the same
 * order T3's app.generate_seating_plan uses: the old row's superseded_by is
 * set to the new id BEFORE the new (superseded_by null) row is inserted, so
 * the "one current row" partial unique index never sees two null rows at
 * once.
 */
async function supersedeWithNewVersion(
  institutionId: string,
  oldPlanId: string,
  examId: string,
  slotStart: string,
  versionNo: number,
  sectionIds: string[],
  seatCount: number,
): Promise<string> {
  const newId = crypto.randomUUID();
  // One transaction: the superseded_by FK is deferrable initially deferred,
  // so the forward reference (old row -> not-yet-inserted new row) is only
  // checked at COMMIT, same as T3's app.generate_seating_plan.
  await sql.begin(async (tx) => {
    await tx`update public.exam_seating_plans set superseded_by = ${newId} where id = ${oldPlanId}`;
    await tx`
      insert into public.exam_seating_plans (
        id, institution_id, exam_id, slot_start, version_no, exam_name, rooms, section_ids, seat_count
      )
      values (
        ${newId}, ${institutionId}, ${examId}, ${slotStart}, ${versionNo}, 'Mid Term',
        ${tx.json([{ room_id: null, seats: seatCount }])}, ${sectionIds}, ${seatCount}
      )
    `;
  });
  return newId;
}

async function createSeat(
  institutionId: string,
  planId: string,
  studentId: string,
  classSectionId: string,
  roomId: string,
  seatNo: number,
): Promise<void> {
  await sql`
    insert into public.exam_seats (institution_id, plan_id, student_id, class_section_id, room_id, seat_no)
    values (${institutionId}, ${planId}, ${studentId}, ${classSectionId}, ${roomId}, ${seatNo})
  `;
}

async function membershipStudentId(institutionId: string, userId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}`;
  return row.student_id as string;
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

/**
 * demo_reset (0001) nulls every self-referencing FK column for the
 * institution in one UPDATE per table before deleting rows — fine for
 * marks/results, whose "one current row" invariant is a deferrable
 * constraint TRIGGER that bypasses itself under demo_reset's
 * `app.allow_reset` GUC. exam_seating_plans' invariant is a plain partial
 * unique INDEX instead (ruling: "partial unique ... (one current)" —
 * partial indexes cannot back a deferrable table constraint in Postgres),
 * so nulling a superseded row's superseded_by mid-reset collides
 * immediately with the already-current row. Clearing this module's own
 * rows first (oldest-version-first, so the FK never dangles) avoids it.
 */
async function cleanupSeatingFixture(institutionId: string): Promise<void> {
  await sql`delete from public.exam_seats where institution_id = ${institutionId}`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId} and superseded_by is not null`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId}`;
}

interface Fixture {
  examId: string;
  sectionId: string;
  roomId: string;
  slotStart: string;
  guardianChildId: string;
  otherChildId: string;
  fixtureStudentId: string;
  currentPlanId: string;
  supersededPlanId: string;
}

/**
 * One section, one exam/slot, two plan versions (v1 superseded by v2).
 * Seats exist for: the guardian's own child (both versions), another
 * family's child (v2 only), and the institution's fixture "student" role
 * (v2 only) — enough to prove own-child, own-row, and version scoping.
 */
async function buildFixture(inst: TestInstitution): Promise<Fixture> {
  const yearId = await createAcademicYear(inst.institutionId);
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
  const roomId = await createRoom(inst.institutionId, { capacity: 10 });
  const examId = await createExam(inst.institutionId, termId);
  const slotStart = "2026-11-16T04:00:00.000Z";

  const guardianChildId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  const otherChildId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  const fixtureStudentId = await membershipStudentId(inst.institutionId, inst.users.student.id);
  const guardianId = await membershipGuardianId(inst.institutionId, inst.users.guardian.id);

  await createEnrolment(inst.institutionId, guardianChildId, sectionId, yearId);
  await createEnrolment(inst.institutionId, otherChildId, sectionId, yearId);
  await createEnrolment(inst.institutionId, fixtureStudentId, sectionId, yearId);
  await linkGuardian(inst.institutionId, guardianId, guardianChildId);

  const supersededPlanId = await createPlan(inst.institutionId, examId, slotStart, 1, [sectionId], 1);
  const currentPlanId = await supersedeWithNewVersion(inst.institutionId, supersededPlanId, examId, slotStart, 2, [sectionId], 3);

  await createSeat(inst.institutionId, supersededPlanId, guardianChildId, sectionId, roomId, 1);
  await createSeat(inst.institutionId, currentPlanId, guardianChildId, sectionId, roomId, 1);
  await createSeat(inst.institutionId, currentPlanId, otherChildId, sectionId, roomId, 2);
  await createSeat(inst.institutionId, currentPlanId, fixtureStudentId, sectionId, roomId, 3);

  return { examId, sectionId, roomId, slotStart, guardianChildId, otherChildId, fixtureStudentId, currentPlanId, supersededPlanId };
}

describe("exam_seating_plans / exam_seats RLS (X06-T2)", () => {
  it("guardian reads own child's current seat only, not another family's, not a superseded one", async () => {
    const inst = await createTestInstitution("seating-guardian");
    try {
      const fx = await buildFixture(inst);
      const { data, error } = await inst.clientAs("guardian").from("exam_seats").select("plan_id, student_id, seat_no");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({ plan_id: fx.currentPlanId, student_id: fx.guardianChildId, seat_no: 1 });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("student reads own seat only", async () => {
    const inst = await createTestInstitution("seating-student");
    try {
      const fx = await buildFixture(inst);
      const { data, error } = await inst.clientAs("student").from("exam_seats").select("plan_id, student_id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({ plan_id: fx.currentPlanId, student_id: fx.fixtureStudentId });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("guardian reads the current plan header, not the superseded one", async () => {
    const inst = await createTestInstitution("seating-guardian-plans");
    try {
      const fx = await buildFixture(inst);
      const { data, error } = await inst.clientAs("guardian").from("exam_seating_plans").select("id");
      expect(error).toBeNull();
      expect(data?.map((r) => r.id)).toEqual([fx.currentPlanId]);
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("teacher, accountant, admissions read no rows on either table", async () => {
    const inst = await createTestInstitution("seating-no-access");
    try {
      await buildFixture(inst);
      for (const role of ["teacher", "accountant", "admissions"] as const) {
        const plans = await inst.clientAs(role).from("exam_seating_plans").select("id");
        const seats = await inst.clientAs(role).from("exam_seats").select("id");
        expect(plans.error).toBeNull();
        expect(plans.data).toHaveLength(0);
        expect(seats.error).toBeNull();
        expect(seats.data).toHaveLength(0);
      }
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("admin and exam_controller read every plan version and every seat", async () => {
    const inst = await createTestInstitution("seating-staff");
    try {
      const fx = await buildFixture(inst);
      for (const role of ["admin", "exam_controller"] as const) {
        const plans = await inst.clientAs(role).from("exam_seating_plans").select("id");
        const seats = await inst.clientAs(role).from("exam_seats").select("id");
        expect(plans.error).toBeNull();
        expect(plans.data?.map((r) => r.id).sort()).toEqual([fx.currentPlanId, fx.supersededPlanId].sort());
        expect(seats.error).toBeNull();
        expect(seats.data).toHaveLength(4); // 1 seat in the superseded plan + 3 in the current plan
      }
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("owner INSERT on either table is rejected at the grant layer (42501)", async () => {
    const inst = await createTestInstitution("seating-grants");
    try {
      const fx = await buildFixture(inst);
      const planInsert = await inst
        .clientAs("owner")
        .from("exam_seating_plans")
        .insert({
          institution_id: inst.institutionId,
          exam_id: fx.examId,
          slot_start: fx.slotStart,
          version_no: 3,
          exam_name: "X",
          rooms: [],
          section_ids: [fx.sectionId],
          seat_count: 0,
        });
      expect(planInsert.error?.code).toBe("42501");

      const seatInsert = await inst
        .clientAs("owner")
        .from("exam_seats")
        .insert({
          institution_id: inst.institutionId,
          plan_id: fx.currentPlanId,
          student_id: fx.otherChildId,
          class_section_id: fx.sectionId,
          room_id: fx.roomId,
          seat_no: 99,
        });
      expect(seatInsert.error?.code).toBe("42501");
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("duplicate (plan, room, seat_no) for a different student is rejected (23505)", async () => {
    const inst = await createTestInstitution("seating-dup-seat");
    try {
      const fx = await buildFixture(inst);
      const extraStudentId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
      await expect(
        // seat_no 2 in this room is already taken (otherChildId) — a different student at the same (plan, room, seat_no) must fail.
        createSeat(inst.institutionId, fx.currentPlanId, extraStudentId, fx.sectionId, fx.roomId, 2),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("a second current plan for one (exam, slot) is rejected (23505)", async () => {
    const inst = await createTestInstitution("seating-dup-plan");
    try {
      const fx = await buildFixture(inst);
      await expect(createPlan(inst.institutionId, fx.examId, fx.slotStart, 3, [fx.sectionId], 1)).rejects.toMatchObject({
        code: "23505",
      });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });
});
