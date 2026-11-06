import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// Migration 0103: practice_attempts + submit_practice_attempt +
// my_upcoming_exam_papers.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function memberCol(institutionId: string, role: string, column: "staff_id" | "guardian_id" | "student_id") {
  const [row] = await sql`select ${sql(column)} as id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.id as string;
}

async function makeBase(inst: TestInstitution, opts: { linkGuardian?: boolean } = {}) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await memberCol(inst.institutionId, "teacher", "staff_id");
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaff });
  const subjectId = await createSubject(inst.institutionId);
  await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherStaff);
  const studentId = await memberCol(inst.institutionId, "student", "student_id");
  const guardianId = await memberCol(inst.institutionId, "guardian", "guardian_id");
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  if (opts.linkGuardian !== false) {
    await sql`
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
      values (${inst.institutionId}, ${guardianId}, ${studentId}, 'mother', true, true)
    `;
  }
  const [unit] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${inst.institutionId}, ${subjectId}, ${gradeId}, 'Fractions', 1)
    returning id
  `;
  return { yearId, gradeId, sectionId, subjectId, studentId, guardianId, unitId: unit.id as string, teacherStaff };
}

const QUESTIONS = [
  { stem: "1+1?", options: ["1", "2", "3", "4"], answerIndex: 1 },
  { stem: "2+2?", options: ["1", "2", "3", "4"], answerIndex: 3 },
  { stem: "3+3?", options: ["6", "2", "3", "4"], answerIndex: 0 },
];

function submit(inst: TestInstitution, role: "student" | "guardian", base: { studentId: string; unitId: string }, answers: unknown[]) {
  return inst.clientAs(role).rpc("submit_practice_attempt", {
    p_institution_id: inst.institutionId,
    p_student_id: base.studentId,
    p_curriculum_unit_id: base.unitId,
    p_difficulty: "easy",
    p_questions: QUESTIONS,
    p_answers: answers,
  });
}

describe("practice attempts (0103)", () => {
  it("recomputes the score server-side from the answer keys", async () => {
    const inst = await createTestInstitution("practice-score");
    try {
      const base = await makeBase(inst);
      const res = await submit(inst, "student", base, [1, 0, 0]); // 1st and 3rd correct
      expect(res.error).toBeNull();
      const row = res.data as { score: number; max_score: number; subject_id: string };
      expect(row.score).toBe(2);
      expect(row.max_score).toBe(3);
      expect(row.subject_id).toBe(base.subjectId);

      const skipped = await submit(inst, "student", base, [null, null, null]);
      expect((skipped.data as { score: number }).score).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("rejects malformed answer arrays and keys", async () => {
    const inst = await createTestInstitution("practice-validate");
    try {
      const base = await makeBase(inst);
      const short = await submit(inst, "student", base, [1]);
      expect(short.error?.message).toBe("code:validation_failed");
      const outOfRange = await submit(inst, "student", base, [1, 9, 0]);
      expect(outOfRange.error?.message).toBe("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a student cannot submit for another student; a guardian cannot submit at all", async () => {
    const inst = await createTestInstitution("practice-other");
    try {
      const base = await makeBase(inst);
      const [other] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2016-01-01', 'other')
        returning id
      `;
      const forOther = await submit(inst, "student", { studentId: other.id, unitId: base.unitId }, [1, 3, 0]);
      expect(forOther.error?.message).toBe("code:forbidden");
      const asGuardian = await submit(inst, "guardian", base, [1, 3, 0]);
      expect(asGuardian.error?.message).toBe("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("rejects a unit whose subject is not taught in the student's section", async () => {
    const inst = await createTestInstitution("practice-unit");
    try {
      const base = await makeBase(inst);
      const foreignSubject = await createSubject(inst.institutionId, { name: "Art" });
      const [unit] = await sql`
        insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
        values (${inst.institutionId}, ${foreignSubject}, ${base.gradeId}, 'Colours', 1)
        returning id
      `;
      const res = await submit(inst, "student", { studentId: base.studentId, unitId: unit.id }, [1, 3, 0]);
      expect(res.error?.message).toBe("code:not_found");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is immutable and cannot be written directly; student, guardian, teacher and admin can read it, strangers cannot", async () => {
    const inst = await createTestInstitution("practice-immutable");
    const other = await createTestInstitution("practice-immutable-b");
    try {
      const base = await makeBase(inst);
      const res = await submit(inst, "student", base, [1, 3, 0]);
      const attemptId = (res.data as { id: string }).id;

      const student = inst.clientAs("student");
      expect((await student.from("practice_attempts").update({ score: 3 }).eq("id", attemptId)).error).not.toBeNull();
      expect((await student.from("practice_attempts").delete().eq("id", attemptId)).error).not.toBeNull();
      expect(
        (
          await student.from("practice_attempts").insert({
            institution_id: inst.institutionId,
            student_id: base.studentId,
            curriculum_unit_id: base.unitId,
            subject_id: base.subjectId,
            difficulty: "easy",
            questions: QUESTIONS,
            answers: [1, 3, 0],
            score: 3,
            max_score: 3,
          })
        ).error,
      ).not.toBeNull();

      for (const role of ["student", "guardian", "teacher", "admin"] as const) {
        const read = await inst.clientAs(role).from("practice_attempts").select("id").eq("id", attemptId);
        expect(read.data, role).toHaveLength(1);
      }
      expect((await other.clientAs("guardian").from("practice_attempts").select("id").eq("id", attemptId)).data).toEqual([]);
      expect((await inst.clientAs("accountant").from("practice_attempts").select("id").eq("id", attemptId)).data).toEqual([]);
    } finally {
      await inst.cleanup();
      await other.cleanup();
    }
  }, 40_000);
});

describe("my_upcoming_exam_papers (0103)", () => {
  async function seedExam(inst: TestInstitution, base: Awaited<ReturnType<typeof makeBase>>, status: string) {
    const termId = await createTerm(inst.institutionId, base.yearId);
    const [exam] = await sql`
      insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
      values (${inst.institutionId}, ${base.yearId}, ${termId}, 'Unit Test 1', 'unit_test', ${status})
      returning id
    `;
    const [paper] = await sql`
      insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, scheduled_at, duration_minutes)
      values (${inst.institutionId}, ${exam.id}, ${base.sectionId}, ${base.subjectId}, 50, 17, now() + interval '5 days', 90)
      returning id
    `;
    return { examId: exam.id as string, paperId: paper.id as string };
  }

  it("student and linked guardian get the section's scheduled papers; a guardian of another child gets nothing; drafts are hidden", async () => {
    const inst = await createTestInstitution("upcoming-exams");
    try {
      const base = await makeBase(inst);
      const { paperId } = await seedExam(inst, base, "marks_entry");

      const asStudent = await inst.clientAs("student").rpc("my_upcoming_exam_papers", { p_student_id: base.studentId });
      expect(asStudent.error).toBeNull();
      expect((asStudent.data as { paper_id: string }[]).map((r) => r.paper_id)).toEqual([paperId]);

      const asGuardian = await inst.clientAs("guardian").rpc("my_upcoming_exam_papers", { p_student_id: base.studentId });
      expect(asGuardian.data).toHaveLength(1);

      const [stranger] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Stranger', '2016-01-01', 'other')
        returning id
      `;
      const wrongChild = await inst.clientAs("guardian").rpc("my_upcoming_exam_papers", { p_student_id: stranger.id });
      expect(wrongChild.data).toEqual([]);
      const teacher = await inst.clientAs("teacher").rpc("my_upcoming_exam_papers", { p_student_id: base.studentId });
      expect(teacher.data).toEqual([]);

      await sql`update public.exams set status = 'draft' where id = ${(await sql`select exam_id from public.exam_papers where id = ${paperId}`)[0].exam_id}`;
      const draft = await inst.clientAs("student").rpc("my_upcoming_exam_papers", { p_student_id: base.studentId });
      expect(draft.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
