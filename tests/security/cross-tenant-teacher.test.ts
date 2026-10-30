import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// T-042 fix round 1 (review HIGH): the teacher-scope helpers trusted
// enrolments/subject_assignments rows without checking that the student,
// section, subject and staff all belong to the row's institution, and those
// tables' write policies didn't bind those FKs either. An A admin could
// enrol B's student into an A section, and A's teacher then read B's
// student, guardian links and results.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let a: TestInstitution;
let b: TestInstitution;
const ids = {} as Record<
  | "aYear"
  | "aSection"
  | "aSubject"
  | "aTeacherStaff"
  | "bYear"
  | "bSection"
  | "bSubject"
  | "bSubject2"
  | "bStudent"
  | "bStaff"
  | "bAssignment"
  | "bResult"
  | "bMark",
  string
>;

beforeAll(async () => {
  [a, b] = await Promise.all([createTestInstitution("xteach-a"), createTestInstitution("xteach-b")]);
  const [am] = await sql`select staff_id from public.memberships where institution_id = ${a.institutionId} and role = 'teacher'`;
  const [bm] = await sql`
    select
      (select student_id from public.memberships where institution_id = ${b.institutionId} and role = 'student') as student,
      (select guardian_id from public.memberships where institution_id = ${b.institutionId} and role = 'guardian') as guardian,
      (select staff_id from public.memberships where institution_id = ${b.institutionId} and role = 'teacher') as staff
  `;
  ids.aTeacherStaff = am.staff_id;
  ids.bStudent = bm.student;
  ids.bStaff = bm.staff;

  ids.aYear = await createAcademicYear(a.institutionId);
  const aGrade = await createGrade(a.institutionId);
  ids.aSubject = await createSubject(a.institutionId);
  ids.aSection = await createClassSection(a.institutionId, aGrade, ids.aYear, { classTeacherId: ids.aTeacherStaff });

  ids.bYear = await createAcademicYear(b.institutionId);
  const bTerm = await createTerm(b.institutionId, ids.bYear);
  const bGrade = await createGrade(b.institutionId);
  ids.bSubject = await createSubject(b.institutionId);
  ids.bSubject2 = await createSubject(b.institutionId, { name: "Science" });
  ids.bSection = await createClassSection(b.institutionId, bGrade, ids.bYear);
  await createSubjectAssignment(b.institutionId, ids.bSection, ids.bSubject, ids.bStaff);
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${b.institutionId}, ${bm.guardian}, ${ids.bStudent}, 'mother', true)
  `;
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (${b.institutionId}, ${ids.bYear}, ${bTerm}, 'B exam', 'unit_test', 'published') returning id
  `;
  const [result] = await sql`
    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
    values (${b.institutionId}, ${exam.id}, ${ids.bStudent}, ${sql.json({ papers: [] })}, 50, 100, 50, 'C', 1, now()) returning id
  `;
  ids.bResult = result.id;
  const [paper] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${b.institutionId}, ${exam.id}, ${ids.bSection}, ${ids.bSubject2}, 100, 33) returning id
  `;
  const [mark] = await sql`
    insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent)
    values (${b.institutionId}, ${paper.id}, ${ids.bStudent}, 50, false) returning id
  `;
  ids.bMark = mark.id;
  const [assignment] = await sql`
    insert into public.assignments (institution_id, class_section_id, subject_id, title, status, created_by)
    values (${b.institutionId}, ${ids.bSection}, ${ids.bSubject2}, 'B homework', 'draft', ${ids.bStaff}) returning id
  `;
  ids.bAssignment = assignment.id;
  await sql`
    insert into public.assignment_answer_keys (institution_id, assignment_id, answers)
    values (${b.institutionId}, ${assignment.id}, ${sql.json({ questions: [{ answer: "B" }] })})
  `;
}, 120_000);

afterAll(async () => {
  await Promise.all([a.cleanup(), b.cleanup()]);
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 60_000);

describe("lesson 2: enrolments / subject_assignments FKs are bound to the row's institution", () => {
  it("an A admin cannot enrol B's student into an A section", async () => {
    const { error } = await a.clientAs("admin").from("enrolments").insert({
      institution_id: a.institutionId,
      student_id: ids.bStudent,
      class_section_id: ids.aSection,
      academic_year_id: ids.aYear,
      started_on: "2026-04-01",
    });
    expect(error).not.toBeNull();
  });

  it("an A admin cannot enrol into B's section or year", async () => {
    const [aStudent] = await sql`select student_id from public.memberships where institution_id = ${a.institutionId} and role = 'student'`;
    for (const row of [
      { class_section_id: ids.bSection, academic_year_id: ids.aYear },
      { class_section_id: ids.aSection, academic_year_id: ids.bYear },
    ]) {
      const { error } = await a
        .clientAs("admin")
        .from("enrolments")
        .insert({ institution_id: a.institutionId, student_id: aStudent.student_id, started_on: "2026-04-01", ...row });
      expect(error).not.toBeNull();
    }
  });

  it("an A admin cannot create a subject assignment naming B's section, subject or staff", async () => {
    for (const row of [
      { class_section_id: ids.bSection, subject_id: ids.aSubject, teacher_id: ids.aTeacherStaff },
      { class_section_id: ids.aSection, subject_id: ids.bSubject, teacher_id: ids.aTeacherStaff },
      { class_section_id: ids.aSection, subject_id: ids.aSubject, teacher_id: ids.bStaff },
    ]) {
      const { error } = await a.clientAs("admin").from("subject_assignments").insert({ institution_id: a.institutionId, ...row });
      expect(error).not.toBeNull();
    }
  });
});

describe("teacher-scope helpers re-check institution even if a malformed row exists", () => {
  it("a cross-institution enrolment row does not expose B's student, links or results to A's teacher", async () => {
    // Simulates a legacy/malformed row written past RLS (postgres session).
    await sql`
      insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
      values (${a.institutionId}, ${ids.bStudent}, ${ids.aSection}, ${ids.aYear}, '2026-04-01', 'active')
      on conflict do nothing
    `;
    const teacher = a.clientAs("teacher");
    const students = await teacher.from("students").select("id").eq("id", ids.bStudent);
    const links = await teacher.from("guardian_students").select("student_id").eq("student_id", ids.bStudent);
    const results = await teacher.from("results").select("id").eq("id", ids.bResult);
    expect([students.data, links.data, results.data]).toEqual([[], [], []]);
  });

  it("a cross-institution subject_assignments row does not expose B's marks or answer keys to A's teacher", async () => {
    await sql`
      insert into public.subject_assignments (institution_id, class_section_id, subject_id, teacher_id)
      values (${a.institutionId}, ${ids.bSection}, ${ids.bSubject2}, ${ids.aTeacherStaff})
      on conflict do nothing
    `;
    const teacher = a.clientAs("teacher");
    const marks = await teacher.from("marks").select("id").eq("id", ids.bMark);
    const keys = await teacher.from("assignment_answer_keys").select("assignment_id").eq("assignment_id", ids.bAssignment);
    expect([marks.error, keys.error]).toEqual([null, null]);
    expect([marks.data, keys.data]).toEqual([[], []]);
  });
});
