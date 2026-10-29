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
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// 05 §4.1 default grading scale, copied verbatim — app.grade_for raises
// code:invalid_state without a configured scale (institutions.settings
// defaults to '{}', 0002).
async function setExamSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'exams', jsonb_build_object(
        'pass_percentage', 33,
        'grading_scales', jsonb_build_object('default', jsonb_build_array(
          jsonb_build_object('min', 91, 'max', 100, 'grade', 'A1', 'points', 10),
          jsonb_build_object('min', 81, 'max', 90, 'grade', 'A2', 'points', 9),
          jsonb_build_object('min', 71, 'max', 80, 'grade', 'B1', 'points', 8),
          jsonb_build_object('min', 61, 'max', 70, 'grade', 'B2', 'points', 7),
          jsonb_build_object('min', 51, 'max', 60, 'grade', 'C1', 'points', 6),
          jsonb_build_object('min', 41, 'max', 50, 'grade', 'C2', 'points', 5),
          jsonb_build_object('min', 33, 'max', 40, 'grade', 'D', 'points', 4),
          jsonb_build_object('min', 21, 'max', 32, 'grade', 'E1', 'points', 0, 'fail', true),
          jsonb_build_object('min', 0, 'max', 20, 'grade', 'E2', 'points', 0, 'fail', true)
        ))
      )
    )
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return student.id as string;
}

async function createExam(institutionId: string, termId: string, overrides: Partial<{ name: string; status: string }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (
      ${institutionId},
      (select academic_year_id from public.terms where id = ${termId}),
      ${termId},
      ${overrides.name ?? `Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test',
      ${overrides.status ?? "draft"}
    )
    returning id
  `;
  return row.id as string;
}

async function createExamPaper(
  institutionId: string,
  examId: string,
  classSectionId: string,
  subjectId: string,
  overrides: Partial<{ maxMarks: number; passMarks: number }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, ${overrides.maxMarks ?? 100}, ${overrides.passMarks ?? 33})
    returning id
  `;
  return row.id as string;
}

async function insertCurrentMark(
  institutionId: string,
  examPaperId: string,
  studentId: string,
  marksObtained: number | null,
  overrides: Partial<{ isAbsent: boolean; source: string }> = {},
): Promise<string> {
  const [{ nextVersion }] = await sql<{ nextVersion: number }[]>`
    select coalesce(max(version_no), 0) + 1 as "nextVersion" from public.marks
    where exam_paper_id = ${examPaperId} and student_id = ${studentId}
  `;
  const [row] = await sql`
    insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent, source, version_no)
    values (${institutionId}, ${examPaperId}, ${studentId}, ${marksObtained}, ${overrides.isAbsent ?? false}, ${overrides.source ?? "entry"}, ${nextVersion})
    returning id
  `;
  return row.id as string;
}

/** One section, two subjects, two students, one exam with two papers; math is
 * taught by the institution's fixture "teacher" (subject_assignments), english
 * by an unrelated staff row — proves marks RLS is subject-scoped, not just
 * section-scoped (DBT-19 lesson). */
async function setupExamFixture(institutionId: string, teacherStaffId: string) {
  await setExamSettings(institutionId);
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId);
  const mathId = await createSubject(institutionId, { code: "MATH", name: "Mathematics" });
  const englishId = await createSubject(institutionId, { code: "ENG", name: "English" });
  await createSubjectAssignment(institutionId, sectionId, mathId, teacherStaffId);

  const [otherStaff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
    returning id
  `;
  await createSubjectAssignment(institutionId, sectionId, englishId, otherStaff.id as string);

  const studentA = await insertStudent(institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  const studentB = await insertStudent(institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  await createEnrolment(institutionId, studentA, sectionId, yearId);
  await createEnrolment(institutionId, studentB, sectionId, yearId);

  const examId = await createExam(institutionId, termId, { status: "marks_entry" });
  const mathPaperId = await createExamPaper(institutionId, examId, sectionId, mathId);
  const englishPaperId = await createExamPaper(institutionId, examId, sectionId, englishId);

  return { yearId, termId, gradeId, sectionId, mathId, englishId, studentA, studentB, examId, mathPaperId, englishPaperId };
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

describe("exams module (T-017) — versioning, publish, recheck (C-40..C-44)", () => {
  it("C-43: marks_obtained > max is rejected; UPDATE of a non-superseded_by column raises; a second current version violates the partial unique", async () => {
    const inst = await createTestInstitution("exams-c43");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId);

      await expect(
        sql`insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent) values (${inst.institutionId}, ${fx.mathPaperId}, ${fx.studentA}, 150, false)`,
      ).rejects.toThrow(/validation_failed/);

      const markId = await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentA, 80);

      await expect(sql`update public.marks set marks_obtained = 10 where id = ${markId}`).rejects.toThrow(/invalid_state/);
      await expect(sql`delete from public.marks where id = ${markId}`).rejects.toThrow(/invalid_state/);

      // A second current row (superseded_by null) for the same (paper, student)
      // — a different version_no, still current — hits the deferred
      // "one current row" constraint trigger at commit.
      await expect(
        sql`insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent, version_no) values (${inst.institutionId}, ${fx.mathPaperId}, ${fx.studentA}, 81, false, 2)`,
      ).rejects.toThrow(/code:conflict/);

      // A bare UPDATE setting superseded_by to a value (nothing else changed)
      // is the one shape the trigger allows through — but app.marks_guard's
      // cross-row check (fix round 1) rejects a target that doesn't exist.
      // The real null -> value -> (blocked second change) supersede
      // sequence, and the cross-student rejection, are exercised end-to-end
      // by C-42 and the "fix round 1" tests below via
      // app.apply_recheck_decision, which performs it correctly in one
      // function call, not via two separate top-level statements the way
      // raw SQL here would have to.
      await expect(sql`update public.marks set superseded_by = gen_random_uuid() where id = ${markId}`).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-40: publishing with one missing mark raises invalid_state and inserts no results", async () => {
    const inst = await createTestInstitution("exams-c40");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId);

      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentA, 80);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentB, 60);
      // studentB's english paper is left unmarked.

      await sql`update public.exams set status = 'verification' where id = ${fx.examId}`;

      const result = await inst.clientAs("exam_controller").rpc("publish_exam_results", { p_exam_id: fx.examId });
      expect(result.error?.message).toBe("code:invalid_state");

      const [{ count }] = await sql`select count(*)::int as count from public.results where exam_id = ${fx.examId}`;
      expect(count).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-41: a clean exam publishes exactly one result per enrolled student with the right total; publishing twice raises invalid_state", async () => {
    const inst = await createTestInstitution("exams-c41");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId);

      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentA, 80);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentB, 60);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentB, 65);

      await sql`update public.exams set status = 'verification' where id = ${fx.examId}`;

      // Role-narrowing (lesson #1): admin and teacher hold app.exam_roles()/
      // staff_roles() respectively but NOT app.exam_write_roles() — publish
      // is owner/principal/exam_controller only.
      const adminAttempt = await inst.clientAs("admin").rpc("publish_exam_results", { p_exam_id: fx.examId });
      expect(adminAttempt.error?.message).toBe("code:forbidden");
      const teacherAttempt = await inst.clientAs("teacher").rpc("publish_exam_results", { p_exam_id: fx.examId });
      expect(teacherAttempt.error?.message).toBe("code:forbidden");

      const published = await inst.clientAs("exam_controller").rpc("publish_exam_results", { p_exam_id: fx.examId });
      expect(published.error).toBeNull();
      expect((published.data as { result_count: number }).result_count).toBe(2);

      const [{ count }] = await sql`select count(*)::int as count from public.results where exam_id = ${fx.examId}`;
      expect(count).toBe(2);

      const [resultA] = await sql`select total, max_total, percentage, grade from public.results where exam_id = ${fx.examId} and student_id = ${fx.studentA}`;
      expect(Number(resultA.total)).toBe(150);
      expect(Number(resultA.max_total)).toBe(200);
      expect(Number(resultA.percentage)).toBe(75);
      expect(resultA.grade).toBe("B1");

      const [exam] = await sql`select status from public.exams where id = ${fx.examId}`;
      expect(exam.status).toBe("published");

      const again = await inst.clientAs("exam_controller").rpc("publish_exam_results", { p_exam_id: fx.examId });
      expect(again.error?.message).toBe("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("C-42: apply_recheck_decision(approve) creates marks v2 + results v2, leaves v1 superseded, applies the request, writes two audit rows and one job; admin is forbidden", async () => {
    const inst = await createTestInstitution("exams-c42");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId);

      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentB, 60);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentB, 65);
      await sql`update public.exams set status = 'verification' where id = ${fx.examId}`;
      await inst.clientAs("exam_controller").rpc("publish_exam_results", { p_exam_id: fx.examId });

      const [resultA] = await sql`select id, version_no from public.results where exam_id = ${fx.examId} and student_id = ${fx.studentA}`;
      const [requestRow] = await sql`
        insert into public.recheck_requests (institution_id, result_id, exam_paper_id, requested_by, reason, status)
        values (${inst.institutionId}, ${resultA.id}, ${fx.mathPaperId}, ${inst.users.guardian.id}, 'Please recheck my Mathematics paper', 'under_review')
        returning id
      `;

      const adminAttempt = await inst.clientAs("admin").rpc("apply_recheck_decision", {
        p_request_id: requestRow.id, p_decision: "approve", p_new_marks: 78, p_note: "admin should not get here",
      });
      expect(adminAttempt.error?.message).toBe("code:forbidden");

      const decided = await inst.clientAs("exam_controller").rpc("apply_recheck_decision", {
        p_request_id: requestRow.id, p_decision: "approve", p_new_marks: 78, p_note: "re-totalled on recheck",
      });
      expect(decided.error).toBeNull();
      const { marks_id: newMarksId, result_id: newResultId } = decided.data as { marks_id: string; result_id: string };

      const [{ count: markVersions }] = await sql`
        select count(*)::int as count from public.marks where exam_paper_id = ${fx.mathPaperId} and student_id = ${fx.studentA}
      `;
      expect(markVersions).toBe(2);

      const [oldMark] = await sql`
        select superseded_by from public.marks where exam_paper_id = ${fx.mathPaperId} and student_id = ${fx.studentA} and version_no = 1
      `;
      expect(oldMark.superseded_by).toBe(newMarksId);

      const [newMark] = await sql`select marks_obtained, source, version_no from public.marks where id = ${newMarksId}`;
      expect(Number(newMark.marks_obtained)).toBe(78);
      expect(newMark.source).toBe("recheck");
      expect(newMark.version_no).toBe(2);

      const [{ count: resultVersions }] = await sql`
        select count(*)::int as count from public.results where exam_id = ${fx.examId} and student_id = ${fx.studentA}
      `;
      expect(resultVersions).toBe(2);

      const [oldResult] = await sql`select superseded_by from public.results where id = ${resultA.id}`;
      expect(oldResult.superseded_by).toBe(newResultId);

      const [newResult] = await sql`select total, version_no from public.results where id = ${newResultId}`;
      expect(Number(newResult.total)).toBe(148); // 78 + 70, vs original 140
      expect(newResult.version_no).toBe(2);

      const [request] = await sql`select status from public.recheck_requests where id = ${requestRow.id}`;
      expect(request.status).toBe("applied");

      const [{ count: auditCount }] = await sql`
        select count(*)::int as count from public.audit_events
        where (entity_type = 'marks' and entity_id = ${newMarksId})
           or (entity_type = 'results' and entity_id = ${newResultId})
      `;
      expect(auditCount).toBe(2);

      const [{ count: jobCount }] = await sql`select count(*)::int as count from public.jobs where idempotency_key = ${"recheck:" + requestRow.id}`;
      expect(jobCount).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-44 (RLS): guardian cannot insert a recheck_requests row for another guardian's child's result", async () => {
    const inst = await createTestInstitution("exams-c44");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId);

      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentB, 60);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentB, 65);
      await sql`update public.exams set status = 'verification' where id = ${fx.examId}`;
      await inst.clientAs("exam_controller").rpc("publish_exam_results", { p_exam_id: fx.examId });

      const [resultB] = await sql`select id from public.results where exam_id = ${fx.examId} and student_id = ${fx.studentB}`;

      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      // Guardian is linked only to studentA, not studentB.
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${fx.studentA}, 'mother', true)
      `;

      const { error } = await inst
        .clientAs("guardian")
        .from("recheck_requests")
        .insert({
          institution_id: inst.institutionId,
          result_id: resultB.id,
          exam_paper_id: fx.mathPaperId,
          requested_by: inst.users.guardian.id,
          reason: "This is not my child but I am trying anyway",
        });

      expect(error).not.toBeNull();

      const [{ count }] = await sql`select count(*)::int as count from public.recheck_requests where result_id = ${resultB.id}`;
      expect(count).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher marks access is subject-scoped, not section-scoped (DBT-19): math teacher reads/writes the math paper, not the english paper in the same section; guardian/student never read marks", async () => {
    const inst = await createTestInstitution("exams-subject-scope");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentA, 70);

      const mathRead = await inst.clientAs("teacher").from("marks").select("*").eq("exam_paper_id", fx.mathPaperId);
      expect(mathRead.error).toBeNull(); // 0 rows is fine, no RLS error

      const englishRead = await inst.clientAs("teacher").from("marks").select("*").eq("exam_paper_id", fx.englishPaperId);
      expect(englishRead.error).toBeNull();
      expect(englishRead.data).toHaveLength(0); // RLS hides it — assigned to math only

      const mathInsert = await inst
        .clientAs("teacher")
        .from("marks")
        .insert({ institution_id: inst.institutionId, exam_paper_id: fx.mathPaperId, student_id: fx.studentA, marks_obtained: 55, is_absent: false });
      expect(mathInsert.error).toBeNull();

      const englishInsert = await inst
        .clientAs("teacher")
        .from("marks")
        .insert({ institution_id: inst.institutionId, exam_paper_id: fx.englishPaperId, student_id: fx.studentB, marks_obtained: 55, is_absent: false });
      expect(englishInsert.error).not.toBeNull();

      for (const role of ["guardian", "student"] as const) {
        const { data, error } = await inst.clientAs(role).from("marks").select("*");
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("fix round 1 (CRITICAL): a correction during marks_entry still works, but no direct write (teacher or exam_controller) can touch marks once the exam is published, and superseded_by can never point at another student's row", async () => {
    const inst = await createTestInstitution("exams-fix1");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId); // status: marks_entry

      // Pre-publish correction during marks_entry still works. RLS already
      // proves a teacher MAY insert/update their own paper (the subject-
      // scope test above); the insert-then-supersede pair itself can only
      // ever be atomic across one transaction — two separate PostgREST
      // calls are two separate commits, and app.marks_one_current_check is
      // deferred to commit, not across requests — same reason
      // app.apply_recheck_decision does both writes itself. sql.begin
      // mirrors that for this guard-level check.
      const v1 = await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentA, 60);
      const v2 = await sql.begin(async (tx) => {
        const [row] = await tx`
          insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent, version_no)
          values (${inst.institutionId}, ${fx.mathPaperId}, ${fx.studentA}, 65, false, 2)
          returning id
        `;
        await tx`update public.marks set superseded_by = ${row.id} where id = ${v1}`;
        return row.id as string;
      });
      const [{ superseded_by: supersededBy }] = await sql`select superseded_by from public.marks where id = ${v1}`;
      expect(supersededBy).toBe(v2);

      // Fill in the rest and publish.
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentB, 60);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentB, 65);
      await sql`update public.exams set status = 'verification' where id = ${fx.examId}`;
      const published = await inst.clientAs("exam_controller").rpc("publish_exam_results", { p_exam_id: fx.examId });
      expect(published.error).toBeNull();

      // Teacher post-publish INSERT is rejected.
      const teacherPostPublishInsert = await inst
        .clientAs("teacher")
        .from("marks")
        .insert({ institution_id: inst.institutionId, exam_paper_id: fx.mathPaperId, student_id: fx.studentA, marks_obtained: 95, is_absent: false, version_no: 3 });
      expect(teacherPostPublishInsert.error).not.toBeNull();

      // exam_controller post-publish direct INSERT is also rejected — RLS
      // has no status gate exception for any role; only app.
      // apply_recheck_decision may touch marks after publish.
      const controllerPostPublishInsert = await inst
        .clientAs("exam_controller")
        .from("marks")
        .insert({ institution_id: inst.institutionId, exam_paper_id: fx.mathPaperId, student_id: fx.studentA, marks_obtained: 95, is_absent: false, version_no: 3 });
      expect(controllerPostPublishInsert.error).not.toBeNull();

      // Direct superseded_by tampering (the reviewer's repro) is rejected by
      // app.marks_guard before it even reaches the status gate's OWN
      // exception — the "other column changed"/target-validation checks
      // fire regardless of exam status.
      const [currentMathA] = await sql`
        select id from public.marks where exam_paper_id = ${fx.mathPaperId} and student_id = ${fx.studentA} and superseded_by is null
      `;
      const teacherPostPublishSupersede = await inst
        .clientAs("teacher")
        .from("marks")
        .update({ superseded_by: currentMathA.id })
        .eq("exam_paper_id", fx.mathPaperId)
        .eq("student_id", fx.studentB)
        .is("superseded_by", null);
      expect(teacherPostPublishSupersede.error).not.toBeNull();
      const [stillCurrentB] = await sql`
        select superseded_by from public.marks where exam_paper_id = ${fx.mathPaperId} and student_id = ${fx.studentB} and version_no = 1
      `;
      expect(stillCurrentB.superseded_by).toBeNull();

      // Cross-student superseded_by is rejected even from a trusted
      // service-style connection that bypasses the status gate (app.
      // marks_guard's target-row check is unconditional, not just for
      // authenticated callers).
      const [currentMathB] = await sql`
        select id from public.marks where exam_paper_id = ${fx.mathPaperId} and student_id = ${fx.studentB} and superseded_by is null
      `;
      await expect(
        sql`update public.marks set superseded_by = ${currentMathA.id} where id = ${currentMathB.id}`,
      ).rejects.toThrow(/invalid_state/);

      // Recheck approve still works post-publish (2 audit rows, one job).
      const [resultA] = await sql`select id from public.results where exam_id = ${fx.examId} and student_id = ${fx.studentA}`;
      const [requestRow] = await sql`
        insert into public.recheck_requests (institution_id, result_id, exam_paper_id, requested_by, reason, status)
        values (${inst.institutionId}, ${resultA.id}, ${fx.mathPaperId}, ${inst.users.guardian.id}, 'Please recheck Mathematics', 'under_review')
        returning id
      `;
      const decided = await inst.clientAs("exam_controller").rpc("apply_recheck_decision", {
        p_request_id: requestRow.id, p_decision: "approve", p_new_marks: 78, p_note: "fix round 1 regression",
      });
      expect(decided.error).toBeNull();
      const { marks_id: newMarksId, result_id: newResultId } = decided.data as { marks_id: string; result_id: string };

      const [{ count: auditCount }] = await sql`
        select count(*)::int as count from public.audit_events
        where (entity_type = 'marks' and entity_id = ${newMarksId}) or (entity_type = 'results' and entity_id = ${newResultId})
      `;
      expect(auditCount).toBe(2);

      const [{ count: jobCount }] = await sql`select count(*)::int as count from public.jobs where idempotency_key = ${"recheck:" + requestRow.id}`;
      expect(jobCount).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("fix round 2: anon has no marks policy at all (still denied), service_role is the explicit trusted bypass on a published exam, and an authenticated exam_controller is not — `current_user_id() is null` is no longer treated as trust", async () => {
    const inst = await createTestInstitution("exams-fix2");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const fx = await setupExamFixture(inst.institutionId, teacherId); // status: marks_entry

      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentA, 60);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentA, 70);
      await insertCurrentMark(inst.institutionId, fx.mathPaperId, fx.studentB, 60);
      await insertCurrentMark(inst.institutionId, fx.englishPaperId, fx.studentB, 65);
      await sql`update public.exams set status = 'verification' where id = ${fx.examId}`;
      const published = await inst.clientAs("exam_controller").rpc("publish_exam_results", { p_exam_id: fx.examId });
      expect(published.error).toBeNull();

      // A third student, enrolled only AFTER publish — not part of the
      // published exam, so it has no current mark for the math paper and
      // this test can insert a fresh (not superseding) row.
      const studentC = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
      await createEnrolment(inst.institutionId, studentC, fx.sectionId, fx.yearId);

      // anon: no RLS policy on marks grants it anything, published or not.
      const anonInsert = await inst
        .clientAsAnon()
        .from("marks")
        .insert({ institution_id: inst.institutionId, exam_paper_id: fx.mathPaperId, student_id: studentC, marks_obtained: 99, is_absent: false });
      expect(anonInsert.error).not.toBeNull();

      // authenticated exam_controller: still rejected post-publish, no GUC set.
      const controllerInsert = await inst
        .clientAs("exam_controller")
        .from("marks")
        .insert({ institution_id: inst.institutionId, exam_paper_id: fx.mathPaperId, student_id: studentC, marks_obtained: 99, is_absent: false });
      expect(controllerInsert.error).not.toBeNull();

      // service_role: PostgREST JWT role claim is 'service_role' — the
      // explicit, named bypass (the seed path), not a side effect of a
      // null auth.uid().
      const serviceClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SECRET_KEY as string,
      );
      const serviceInsert = await serviceClient
        .from("marks")
        .insert({ institution_id: inst.institutionId, exam_paper_id: fx.mathPaperId, student_id: studentC, marks_obtained: 99, is_absent: false })
        .select("id")
        .single();
      expect(serviceInsert.error).toBeNull();

      const [{ count }] = await sql`
        select count(*)::int as count from public.marks
        where exam_paper_id = ${fx.mathPaperId} and student_id = ${studentC} and marks_obtained = 99
      `;
      expect(count).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });
});
