import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { closeRolesHelper, createTestInstitution, ROLES, type FixtureRole, type TestInstitution } from "../helpers/roles";

// T-042: within-institution read/write scope the cross-tenant generated suite
// (rls-generated.test.ts) can't see — DBT-17 (07 §2.2 read columns), DBT-19
// (subject-level assignment writes) and the report-card exam-name gap
// (T-041 "Found": guardians/students could never read `exams`).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let inst: TestInstitution;
let otherInstitutionId: string;
const ids = {} as Record<
  | "teacherStaff"
  | "year"
  | "term"
  | "math"
  | "science"
  | "taughtSection"
  | "otherSection"
  | "ownStudent"
  | "childStudent"
  | "otherStudent"
  | "assignmentTaught"
  | "assignmentOther"
  | "examOwn"
  | "examOther"
  | "examDraft"
  | "foreignSection"
  | "classTeacherSection",
  string
>;

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Scope', '2015-01-01', 'other') returning id
  `;
  return row.id as string;
}

async function insertAssignment(sectionId: string, subjectId: string, title: string): Promise<string> {
  const [row] = await sql`
    insert into public.assignments (institution_id, class_section_id, subject_id, title, status, created_by)
    values (${inst.institutionId}, ${sectionId}, ${subjectId}, ${title}, 'published', ${ids.teacherStaff}) returning id
  `;
  return row.id as string;
}

async function insertPublishedExam(name: string, status = "published"): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (${inst.institutionId}, ${ids.year}, ${ids.term}, ${name}, 'half_yearly', ${status}) returning id
  `;
  return row.id as string;
}

async function insertResult(examId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
    values (${inst.institutionId}, ${examId}, ${studentId}, ${sql.json({ papers: [] })}, 50, 100, 50, 'C', 1, now())
  `;
}

beforeAll(async () => {
  inst = await createTestInstitution("rls-scope");
  const i = inst.institutionId;
  const [m] = await sql`
    select
      (select staff_id from public.memberships where institution_id = ${i} and role = 'teacher') as teacher_staff,
      (select student_id from public.memberships where institution_id = ${i} and role = 'student') as own_student,
      (select guardian_id from public.memberships where institution_id = ${i} and role = 'guardian') as guardian
  `;
  ids.teacherStaff = m.teacher_staff;
  ids.ownStudent = m.own_student;

  ids.year = await createAcademicYear(i);
  ids.term = await createTerm(i, ids.year);
  const grade = await createGrade(i);
  ids.math = await createSubject(i, { name: "Mathematics" });
  ids.science = await createSubject(i, { name: "Science" });
  ids.taughtSection = await createClassSection(i, grade, ids.year, { name: "A" });
  ids.otherSection = await createClassSection(i, grade, ids.year, { name: "B" });
  // Subject teacher of Mathematics only, in section A only.
  await createSubjectAssignment(i, ids.taughtSection, ids.math, ids.teacherStaff);
  // Class teacher (no subject rows) of an empty section C.
  ids.classTeacherSection = await createClassSection(i, grade, ids.year, { name: "C", classTeacherId: ids.teacherStaff });

  ids.childStudent = await insertStudent(i, `ADM-SCOPE-CHILD-${i.slice(0, 6)}`);
  ids.otherStudent = await insertStudent(i, `ADM-SCOPE-OTHER-${i.slice(0, 6)}`);
  await createEnrolment(i, ids.childStudent, ids.taughtSection, ids.year);
  await createEnrolment(i, ids.ownStudent, ids.taughtSection, ids.year);
  await createEnrolment(i, ids.otherStudent, ids.otherSection, ids.year);
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${i}, ${m.guardian}, ${ids.childStudent}, 'mother', true)
  `;
  const [otherGuardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone) values (${i}, 'Other Guardian', '9811111111') returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${i}, ${otherGuardian.id}, ${ids.otherStudent}, 'father', true)
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${i}, ${otherGuardian.id}, ${ids.ownStudent}, 'father', true)
  `;

  ids.assignmentTaught = await insertAssignment(ids.taughtSection, ids.math, "Taught section homework");
  ids.assignmentOther = await insertAssignment(ids.otherSection, ids.math, "Other section homework");

  ids.examOwn = await insertPublishedExam("Half-Yearly (own)");
  ids.examOther = await insertPublishedExam("Half-Yearly (other)");
  ids.examDraft = await insertPublishedExam("Draft exam", "draft");
  await insertResult(ids.examOwn, ids.childStudent);
  await insertResult(ids.examOwn, ids.ownStudent);
  await insertResult(ids.examOther, ids.otherStudent);

  // A bare second institution (no users) — only for the FK-binding probes.
  otherInstitutionId = crypto.randomUUID();
  await sql`insert into public.institutions (id, slug, name, is_demo) values (${otherInstitutionId}, ${`test-rls-scope-other-${otherInstitutionId}`}, 'Other', true)`;
  const otherYear = await createAcademicYear(otherInstitutionId);
  const otherGrade = await createGrade(otherInstitutionId);
  ids.foreignSection = await createClassSection(otherInstitutionId, otherGrade, otherYear);
}, 120_000);

afterAll(async () => {
  await inst.cleanup();
  await sql`select app.demo_reset(${otherInstitutionId}::uuid)`;
  await sql`delete from public.institutions where id = ${otherInstitutionId}`;
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 60_000);

async function visibleIds(role: FixtureRole, table: string, column: string, values: string[]): Promise<string[]> {
  const { data, error } = await inst.clientAs(role).from(table).select(column).in(column, values);
  expect(error).toBeNull();
  return ((data ?? []) as unknown as Record<string, string>[]).map((r) => r[column]).sort();
}

describe("DBT-17: staff SELECT follows the 07 §2.2 read columns, not every staff role", () => {
  it("student.read: teacher reads only students actively enrolled in a section they teach", async () => {
    const all = [ids.childStudent, ids.otherStudent];
    expect(await visibleIds("teacher", "students", "id", all)).toEqual([ids.childStudent]);
    for (const role of ["owner", "principal", "admin", "admissions", "accountant", "exam_controller"] as const) {
      expect(await visibleIds(role, "students", "id", all)).toEqual([...all].sort());
    }
  });

  it("enrolments and their status history follow the same teacher section scope", async () => {
    const enrolments = await sql`select id, student_id from public.enrolments where institution_id = ${inst.institutionId}`;
    const byStudent = Object.fromEntries(enrolments.map((e) => [e.student_id, e.id as string]));
    const visible = await visibleIds("teacher", "enrolments", "student_id", [ids.childStudent, ids.otherStudent]);
    expect(visible).toEqual([ids.childStudent]);

    const history = await visibleIds("teacher", "enrolment_status_history", "enrolment_id", [
      byStudent[ids.childStudent],
      byStudent[ids.otherStudent],
    ]);
    expect(history).not.toContain(byStudent[ids.otherStudent]);
  });

  it("guardian_students: teacher sees links only for students in a section they teach", async () => {
    const visible = await visibleIds("teacher", "guardian_students", "student_id", [ids.childStudent, ids.otherStudent]);
    expect(visible).toEqual([ids.childStudent]);
  });

  it("fix round 1: a student reads no guardian_students links (07 §2.2 guardian.read has no student column); the guardian still reads their own", async () => {
    expect(await visibleIds("student", "guardian_students", "student_id", [ids.ownStudent, ids.childStudent])).toEqual([]);
    expect(await visibleIds("guardian", "guardian_students", "student_id", [ids.childStudent])).toEqual([ids.childStudent]);
  });

  it("guardian.read: exam_controller reads no guardian_students links (07 §2.2 excludes it)", async () => {
    expect(await visibleIds("exam_controller", "guardian_students", "student_id", [ids.childStudent, ids.otherStudent])).toEqual([]);
    expect(await visibleIds("accountant", "guardian_students", "student_id", [ids.childStudent, ids.otherStudent])).toHaveLength(2);
  });

  it("assignment.read: admissions/accountant/exam_controller read no assignments; teacher only taught sections", async () => {
    const all = [ids.assignmentTaught, ids.assignmentOther];
    for (const role of ["admissions", "accountant", "exam_controller"] as const) {
      expect(await visibleIds(role, "assignments", "id", all)).toEqual([]);
    }
    for (const role of ["owner", "principal", "admin"] as const) {
      expect(await visibleIds(role, "assignments", "id", all)).toEqual([...all].sort());
    }
    expect(await visibleIds("teacher", "assignments", "id", all)).toEqual([ids.assignmentTaught]);
    expect(await visibleIds("guardian", "assignments", "id", all)).toEqual([ids.assignmentTaught]);
    expect(await visibleIds("student", "assignments", "id", all)).toEqual([ids.assignmentTaught]);
  });
});

describe("DBT-19: assignments writes are subject-scoped for teachers", () => {
  const base = () => ({
    institution_id: inst.institutionId,
    class_section_id: ids.taughtSection,
    title: "DBT-19 probe",
    status: "draft",
    created_by: ids.teacherStaff,
  });

  it("teacher can insert for the subject they teach in that section", async () => {
    const { error } = await inst.clientAs("teacher").from("assignments").insert({ ...base(), subject_id: ids.math });
    expect(error).toBeNull();
  });

  it("teacher cannot insert for another subject in a section they teach", async () => {
    const { error } = await inst.clientAs("teacher").from("assignments").insert({ ...base(), subject_id: ids.science });
    expect(error).not.toBeNull();
  });

  it("teacher cannot move their own assignment to another subject", async () => {
    const { data, error } = await inst
      .clientAs("teacher")
      .from("assignments")
      .update({ subject_id: ids.science })
      .eq("id", ids.assignmentTaught)
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const [row] = await sql`select subject_id from public.assignments where id = ${ids.assignmentTaught}`;
    expect(row.subject_id).toBe(ids.math);
  });

  it("the section's class teacher may write any subject there, answer key included", async () => {
    const client = inst.clientAs("teacher");
    const { data, error } = await client
      .from("assignments")
      .insert({ ...base(), class_section_id: ids.classTeacherSection, subject_id: ids.science })
      .select("id")
      .single();
    expect(error).toBeNull();
    const key = await client
      .from("assignment_answer_keys")
      .insert({ institution_id: inst.institutionId, assignment_id: data!.id, answers: { questions: [{ answer: "A" }] } })
      .select("assignment_id");
    expect(key.error).toBeNull();
    expect(key.data).toHaveLength(1);
  });

  it("fix round 1: teacher cannot create an assignment attributed to another staff member", async () => {
    const [owner] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'owner'`;
    const { error } = await inst
      .clientAs("teacher")
      .from("assignments")
      .insert({ ...base(), subject_id: ids.math, created_by: owner.staff_id });
    expect(error).not.toBeNull();
  });

  it("fix round 1: teacher cannot re-attribute an in-scope assignment, but can still edit a co-teacher's draft", async () => {
    const [owner] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'owner'`;
    const [coTeacherDraft] = await sql`
      insert into public.assignments (institution_id, class_section_id, subject_id, title, status, created_by)
      values (${inst.institutionId}, ${ids.taughtSection}, ${ids.math}, 'Owner draft', 'draft', ${owner.staff_id}) returning id
    `;
    const client = inst.clientAs("teacher");
    const retitle = await client.from("assignments").update({ title: "Edited by teacher" }).eq("id", coTeacherDraft.id).select("id");
    expect(retitle.error).toBeNull();
    expect(retitle.data).toHaveLength(1);

    const reattribute = await client
      .from("assignments")
      .update({ created_by: ids.teacherStaff })
      .eq("id", coTeacherDraft.id)
      .select("id");
    expect(reattribute.error !== null || (reattribute.data ?? []).length === 0).toBe(true);
    const [row] = await sql`select created_by from public.assignments where id = ${coTeacherDraft.id}`;
    expect(row.created_by).toBe(owner.staff_id);
  });

  it("owner cannot point an assignment at another institution's section (FK bound to institution)", async () => {
    const { error } = await inst
      .clientAs("owner")
      .from("assignments")
      .insert({ ...base(), class_section_id: ids.foreignSection, subject_id: ids.math });
    expect(error).not.toBeNull();
  });
});

describe("T-041 found: guardians/students read the exams their own results belong to", () => {
  const exams = () => [ids.examOwn, ids.examOther, ids.examDraft];

  it("guardian reads only the published exam their linked child has a result in", async () => {
    expect(await visibleIds("guardian", "exams", "id", exams())).toEqual([ids.examOwn]);
  });

  it("student reads only the published exam they have a result in", async () => {
    expect(await visibleIds("student", "exams", "id", exams())).toEqual([ids.examOwn]);
  });

  it("the report-card embed exams(name) resolves for the guardian", async () => {
    const { data, error } = await inst
      .clientAs("guardian")
      .from("results")
      .select("exam_id, exams(name)")
      .eq("student_id", ids.childStudent);
    expect(error).toBeNull();
    expect(data).toEqual([{ exam_id: ids.examOwn, exams: { name: "Half-Yearly (own)" } }]);
  });

  it("staff exam reads are unchanged", async () => {
    for (const role of ROLES.filter((r) => r !== "student" && r !== "guardian")) {
      expect(await visibleIds(role, "exams", "id", exams())).toHaveLength(3);
    }
  });
});
