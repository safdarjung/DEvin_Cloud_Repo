import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { notifyMarksReminders } from "@/modules/jobs/handlers/index";
import { istDay } from "@/modules/practice/scoring";
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

// 0154 — marks deadline: exam_marks_progress counts, the RLS fence on setting the date, the daily
// sweep, and notify.marks_reminders (teacher + exam office, idempotent per day).
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const created: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((inst) => inst.cleanup()));
});

function makeJob(institutionId: string) {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    institution_id: institutionId,
    type: "notify.marks_reminders" as const,
    payload: {},
    idempotency_key: "k",
    status: "running" as const,
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

/** Maths (fixture teacher) and English (a staff row with no login) for one section of two students; one maths mark in; marks due today. */
async function fixture(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
  const mathId = await createSubject(inst.institutionId, { code: "MATH", name: "Mathematics" });
  const englishId = await createSubject(inst.institutionId, { code: "ENG", name: "English" });
  const [teacher] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
  const [teacherStaff] = await sql`select full_name from public.staff where id = ${teacher.staff_id}`;
  await createSubjectAssignment(inst.institutionId, sectionId, mathId, teacher.staff_id as string);
  const [other] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Veronica Without Login', 'teacher')
    returning id
  `;
  await createSubjectAssignment(inst.institutionId, sectionId, englishId, other.id as string);
  const students: string[] = [];
  for (const n of [1, 2]) {
    const [s] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}-${n}`}, 'Test Student', '2014-01-01', 'other')
      returning id
    `;
    await createEnrolment(inst.institutionId, s.id as string, sectionId, yearId);
    students.push(s.id as string);
  }
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status, marks_due_on)
    values (${inst.institutionId}, ${yearId}, ${termId}, 'UT1', 'unit_test', 'marks_entry', ${istDay(new Date())})
    returning id
  `;
  const [math] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${inst.institutionId}, ${exam.id}, ${sectionId}, ${mathId}, 80, 33) returning id
  `;
  const [english] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${inst.institutionId}, ${exam.id}, ${sectionId}, ${englishId}, 80, 33) returning id
  `;
  await sql`
    insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained)
    values (${inst.institutionId}, ${math.id}, ${students[0]}, 50)
  `;
  return { examId: exam.id as string, mathPaper: math.id as string, englishPaper: english.id as string, teacherName: teacherStaff.full_name as string, students };
}

describe("marks deadline (0154)", () => {
  it("exam_marks_progress counts current marks against active students, under the caller's RLS", async () => {
    const inst = await createTestInstitution("marks-progress");
    created.push(inst);
    const f = await fixture(inst);
    const { data, error } = await inst.clientAs("teacher").rpc("exam_marks_progress", { p_institution_id: inst.institutionId, p_exam_id: f.examId });
    expect(error).toBeNull();
    const byPaper = Object.fromEntries((data ?? []).map((r: { paper_id: string; entered: number; total: number }) => [r.paper_id, [r.entered, r.total]]));
    expect(byPaper).toEqual({ [f.mathPaper]: [1, 2], [f.englishPaper]: [0, 2] });
  });

  it("only exam.manage roles can set the due date: a teacher's update changes nothing, an exam controller's sticks", async () => {
    const inst = await createTestInstitution("marks-due-rls");
    created.push(inst);
    const f = await fixture(inst);
    const asTeacher = await inst.clientAs("teacher").from("exams").update({ marks_due_on: "2030-01-01" }).eq("id", f.examId).select("id");
    expect(asTeacher.data ?? []).toEqual([]);
    const asController = await inst.clientAs("exam_controller").from("exams").update({ marks_due_on: "2030-01-02" }).eq("id", f.examId).select("id");
    expect(asController.error).toBeNull();
    const [row] = await sql`select marks_due_on::text as d from public.exams where id = ${f.examId}`;
    expect(row.d).toBe("2030-01-02");
  });

  it("the daily sweep enqueues one reminder job per institution and day", async () => {
    const inst = await createTestInstitution("marks-sweep");
    created.push(inst);
    await fixture(inst);
    await admin.rpc("enqueue_marks_reminders");
    await admin.rpc("enqueue_marks_reminders");
    const jobs = await sql`select type from public.jobs where institution_id = ${inst.institutionId} and type = 'notify.marks_reminders'`;
    expect(jobs).toHaveLength(1);
    await sql`delete from public.jobs where institution_id = ${inst.institutionId}`;
  });

  it("reminds the teacher of their own missing paper and tells the exam office who is late by name, once per day", async () => {
    const inst = await createTestInstitution("marks-remind");
    created.push(inst);
    const f = await fixture(inst);
    await notifyMarksReminders(makeJob(inst.institutionId), { admin });
    await notifyMarksReminders(makeJob(inst.institutionId), { admin });

    const rows = await sql`
      select recipient_user_id, body from public.notifications
      where institution_id = ${inst.institutionId} and type = 'marks_reminder'
    `;
    const toTeacher = rows.filter((r) => r.recipient_user_id === inst.users.teacher.id);
    expect(toTeacher).toHaveLength(1);
    expect(toTeacher[0].body).toMatch(/^UT1: marks are due today for .*Mathematics \(1\/2\)\.$/);

    const office = rows.filter((r) => r.recipient_user_id !== inst.users.teacher.id);
    const officeIds = office.map((r) => r.recipient_user_id).sort();
    expect(officeIds).toEqual([inst.users.owner.id, inst.users.principal.id, inst.users.exam_controller.id].sort());
    expect(office[0].body).toContain(`${f.teacherName}: `);
    expect(office[0].body).toContain("Veronica Without Login: ");
    expect(office[0].body).toContain("English (0/2)");
  });

  it("sends nothing once every paper's marks are in", async () => {
    const inst = await createTestInstitution("marks-complete");
    created.push(inst);
    const f = await fixture(inst);
    await sql`
      insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent)
      values (${inst.institutionId}, ${f.mathPaper}, ${f.students[1]}, null, true),
             (${inst.institutionId}, ${f.englishPaper}, ${f.students[0]}, 40, false),
             (${inst.institutionId}, ${f.englishPaper}, ${f.students[1]}, 60, false)
    `;
    await notifyMarksReminders(makeJob(inst.institutionId), { admin });
    const rows = await sql`select 1 from public.notifications where institution_id = ${inst.institutionId} and type = 'marks_reminder'`;
    expect(rows).toHaveLength(0);
  });
});
