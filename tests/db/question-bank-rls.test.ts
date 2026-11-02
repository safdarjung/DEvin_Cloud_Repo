import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherIds(institutionId: string): Promise<{ userId: string; staffId: string }> {
  const [row] = await sql`
    select user_id, staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'
  `;
  return { userId: row.user_id as string, staffId: row.staff_id as string };
}

async function userId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select user_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.user_id as string;
}

async function createRoom(institutionId: string, overrides: Partial<{ name: string }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.rooms (institution_id, name, capacity)
    values (${institutionId}, ${overrides.name ?? `Room-${crypto.randomUUID().slice(0, 6)}`}, 30)
    returning id
  `;
  return row.id as string;
}

async function createExam(institutionId: string, termId: string, overrides: Partial<{ status: string }> = {}): Promise<string> {
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

async function createExamPaper(institutionId: string, examId: string, classSectionId: string, subjectId: string): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, 100, 33)
    returning id
  `;
  return row.id as string;
}

interface Base {
  yearId: string;
  gradeId: string;
  sectionA: string;
  subjectTaught: string;
  subjectUntaught: string;
  teacherUserId: string;
  teacherStaffId: string;
}

async function buildBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectTaught = await createSubject(inst.institutionId, { code: "MATH" });
  const subjectUntaught = await createSubject(inst.institutionId, { code: "SCI" });
  const { userId: teacherUserId, staffId: teacherStaffId } = await teacherIds(inst.institutionId);
  await createSubjectAssignment(inst.institutionId, sectionA, subjectTaught, teacherStaffId);
  return { yearId, gradeId, sectionA, subjectTaught, subjectUntaught, teacherUserId, teacherStaffId };
}

function mcqPayload(institutionId: string, subjectId: string, gradeId: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  return {
    institution_id: institutionId,
    subject_id: subjectId,
    grade_id: gradeId,
    type: "mcq",
    difficulty: "easy",
    body: "What is 2 + 2?",
    options: ["3", "4"],
    answer: "4",
    marks: 1,
    created_by: createdBy,
    ...overrides,
  };
}

describe("question_bank migration (0073) RLS", () => {
  it("exam_controller inserts an mcq", async () => {
    const inst = await createTestInstitution("qb-exam-controller-insert");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");
      const { error } = await inst
        .clientAs("exam_controller")
        .from("question_bank")
        .insert(mcqPayload(inst.institutionId, base.subjectTaught, base.gradeId, controllerId));
      expect(error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("mcq without options is rejected (23514)", async () => {
    const inst = await createTestInstitution("qb-mcq-no-options");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");
      const { error } = await inst
        .clientAs("exam_controller")
        .from("question_bank")
        .insert(mcqPayload(inst.institutionId, base.subjectTaught, base.gradeId, controllerId, { options: null }));
      expect(error?.code).toBe("23514");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher inserts for a taught (grade, subject) -> ok; untaught subject -> 42501", async () => {
    const inst = await createTestInstitution("qb-teacher-scope-insert");
    try {
      const base = await buildBase(inst);

      const ok = await inst
        .clientAs("teacher")
        .from("question_bank")
        .insert(mcqPayload(inst.institutionId, base.subjectTaught, base.gradeId, base.teacherUserId));
      expect(ok.error).toBeNull();

      const forbidden = await inst
        .clientAs("teacher")
        .from("question_bank")
        .insert(mcqPayload(inst.institutionId, base.subjectUntaught, base.gradeId, base.teacherUserId));
      expect(forbidden.error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher SELECT sees only taught (grade, subject) pairs", async () => {
    const inst = await createTestInstitution("qb-teacher-select-scope");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");

      const [taught] = await sql`
        insert into public.question_bank (institution_id, subject_id, grade_id, type, difficulty, body, answer, marks, created_by)
        values (${inst.institutionId}, ${base.subjectTaught}, ${base.gradeId}, 'short_answer', 'easy', 'Taught Q', 'ans', 1, ${controllerId})
        returning id
      `;
      const [untaught] = await sql`
        insert into public.question_bank (institution_id, subject_id, grade_id, type, difficulty, body, answer, marks, created_by)
        values (${inst.institutionId}, ${base.subjectUntaught}, ${base.gradeId}, 'short_answer', 'easy', 'Untaught Q', 'ans', 1, ${controllerId})
        returning id
      `;

      const { data } = await inst.clientAs("teacher").from("question_bank").select("id");
      const ids = data?.map((r) => r.id) ?? [];
      expect(ids).toContain(taught.id);
      expect(ids).not.toContain(untaught.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher UPDATE of another teacher's question matches 0 rows", async () => {
    const inst = await createTestInstitution("qb-teacher-update-0-rows");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");

      const [row] = await sql`
        insert into public.question_bank (institution_id, subject_id, grade_id, type, difficulty, body, answer, marks, created_by)
        values (${inst.institutionId}, ${base.subjectTaught}, ${base.gradeId}, 'short_answer', 'easy', 'Owned by controller', 'ans', 1, ${controllerId})
        returning id
      `;

      const { data, error } = await inst.clientAs("teacher").from("question_bank").update({ body: "Hijacked" }).eq("id", row.id).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const [after] = await sql`select body from public.question_bank where id = ${row.id}`;
      expect(after.body).toBe("Owned by controller");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot update created_by (42501, column grant)", async () => {
    const inst = await createTestInstitution("qb-teacher-update-created-by");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");

      const [row] = await sql`
        insert into public.question_bank (institution_id, subject_id, grade_id, type, difficulty, body, answer, marks, created_by)
        values (${inst.institutionId}, ${base.subjectTaught}, ${base.gradeId}, 'short_answer', 'easy', 'Mine', 'ans', 1, ${base.teacherUserId})
        returning id
      `;

      const { error } = await inst.clientAs("teacher").from("question_bank").update({ created_by: controllerId }).eq("id", row.id);
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian, student, admin SELECT -> []", async () => {
    const inst = await createTestInstitution("qb-non-staff-select");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");
      await sql`
        insert into public.question_bank (institution_id, subject_id, grade_id, type, difficulty, body, answer, marks, created_by)
        values (${inst.institutionId}, ${base.subjectTaught}, ${base.gradeId}, 'short_answer', 'easy', 'Q', 'ans', 1, ${controllerId})
      `;

      for (const role of ["guardian", "student", "admin"] as const) {
        const { data } = await inst.clientAs(role).from("question_bank").select("id");
        expect(data).toEqual([]);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian INSERT -> 42501", async () => {
    const inst = await createTestInstitution("qb-guardian-insert");
    try {
      const base = await buildBase(inst);
      const guardianUserId = await userId(inst.institutionId, "guardian");
      const { error } = await inst
        .clientAs("guardian")
        .from("question_bank")
        .insert(mcqPayload(inst.institutionId, base.subjectTaught, base.gradeId, guardianUserId));
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("curriculum_unit_id of a different subject is rejected", async () => {
    const inst = await createTestInstitution("qb-unit-subject-mismatch");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");
      const [unit] = await sql`
        insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
        values (${inst.institutionId}, ${base.subjectUntaught}, ${base.gradeId}, 'Unit 1', 1)
        returning id
      `;

      const { error } = await inst.clientAs("exam_controller").from("question_bank").insert({
        ...mcqPayload(inst.institutionId, base.subjectTaught, base.gradeId, controllerId),
        curriculum_unit_id: unit.id,
      });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("institution B's subject is rejected for institution A's exam_controller", async () => {
    const instA = await createTestInstitution("qb-cross-subject-a");
    const instB = await createTestInstitution("qb-cross-subject-b");
    try {
      const baseA = await buildBase(instA);
      const baseB = await buildBase(instB);
      const controllerIdA = await userId(instA.institutionId, "exam_controller");

      const { error } = await instA
        .clientAs("exam_controller")
        .from("question_bank")
        .insert(mcqPayload(instA.institutionId, baseB.subjectTaught, baseA.gradeId, controllerIdA));
      expect(error).not.toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("exam_papers: institution B's room is rejected", async () => {
    const instA = await createTestInstitution("qb-exam-papers-cross-room-a");
    const instB = await createTestInstitution("qb-exam-papers-cross-room-b");
    try {
      const baseA = await buildBase(instA);
      const termA = await createTerm(instA.institutionId, baseA.yearId);
      const examA = await createExam(instA.institutionId, termA);
      const roomB = await createRoom(instB.institutionId);

      const { error } = await instA.clientAs("exam_controller").from("exam_papers").insert({
        institution_id: instA.institutionId,
        exam_id: examA,
        class_section_id: baseA.sectionA,
        subject_id: baseA.subjectTaught,
        max_marks: 100,
        pass_marks: 33,
        scheduled_at: "2026-11-10T04:00:00Z",
        duration_minutes: 60,
        room_id: roomB,
      });
      expect(error).not.toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("exam_papers: scheduled_at without duration_minutes is rejected (23514)", async () => {
    const inst = await createTestInstitution("qb-exam-papers-missing-duration");
    try {
      const base = await buildBase(inst);
      const termId = await createTerm(inst.institutionId, base.yearId);
      const examId = await createExam(inst.institutionId, termId);
      const paperId = await createExamPaper(inst.institutionId, examId, base.sectionA, base.subjectTaught);

      await expect(
        sql`update public.exam_papers set scheduled_at = '2026-11-10T04:00:00Z' where id = ${paperId}`,
      ).rejects.toThrow();
    } finally {
      await inst.cleanup();
    }
  });

  it("exam_papers: room_id without scheduled_at is rejected (23514)", async () => {
    const inst = await createTestInstitution("qb-exam-papers-room-no-schedule");
    try {
      const base = await buildBase(inst);
      const termId = await createTerm(inst.institutionId, base.yearId);
      const examId = await createExam(inst.institutionId, termId);
      const roomId = await createRoom(inst.institutionId);

      const { error } = await inst.clientAs("exam_controller").from("exam_papers").insert({
        institution_id: inst.institutionId,
        exam_id: examId,
        class_section_id: base.sectionA,
        subject_id: base.subjectTaught,
        max_marks: 100,
        pass_marks: 33,
        room_id: roomId,
      });
      expect(error?.code).toBe("23514");
    } finally {
      await inst.cleanup();
    }
  });
});
