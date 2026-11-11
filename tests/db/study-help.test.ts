// 0140 — study help RLS: file references bound to what the caller can read,
// questions to the subject's teachers of the student's own section, guardian
// reads of a child's plan/questions, homework links only for a teacher's own
// material and taught sections, worksheets never shared, mock attempts,
// exam-paper scope, scoped study chats, and no cross-school reads or writes.
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, createSubjectAssignment, createTerm } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);

let inst: TestInstitution;
let other: TestInstitution;
let subjectId: string;
let otherSubjectId: string;
let unitId: string;
let otherUnitId: string;
let sectionA: string; // the fixture teacher teaches subjectId here; student A is enrolled
let sectionB: string; // another (login-less) teacher teaches it; student B is enrolled
let studentA: string;
let studentB: string;
let userB: string;
let clientB: SupabaseClient;
let paperA: string;
let paperB: string;

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

async function createSecondStudent(institutionId: string): Promise<{ userId: string; studentId: string; client: SupabaseClient }> {
  const email = `test-help-b-${crypto.randomUUID()}@test.coolskool.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const student = await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-HB-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other') returning id`);
  await sql`insert into public.memberships (institution_id, user_id, role, student_id) values (${institutionId}, ${data.user.id}, 'student', ${student.id})`;
  const client = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, studentId: student.id as string, client };
}

beforeAll(async () => {
  inst = await createTestInstitution("study-help");
  other = await createTestInstitution("study-help-x");
  const yearId = await createAcademicYear(inst.institutionId);
  const termId = await createTerm(inst.institutionId, yearId);
  const gradeId = await createGrade(inst.institutionId, { code: "VIII" });
  subjectId = await createSubject(inst.institutionId, { name: "Science" });
  otherSubjectId = await createSubject(other.institutionId, { name: "Science" });
  const otherGrade = await createGrade(other.institutionId, { code: "VIII" });
  unitId = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence)
    values (${inst.institutionId}, ${subjectId}, ${gradeId}, 'Light', 'Reflection.', 1) returning id`)).id as string;
  otherUnitId = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence)
    values (${other.institutionId}, ${otherSubjectId}, ${otherGrade}, 'Light', 'Reflection.', 1) returning id`)).id as string;
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  const otherStaff = (await one(sql`insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`E-${crypto.randomUUID().slice(0, 6)}`}, 'Other Teacher', 'Teacher') returning id`)).id as string;
  sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  await createSubjectAssignment(inst.institutionId, sectionA, subjectId, teacherStaff);
  await createSubjectAssignment(inst.institutionId, sectionB, subjectId, otherStaff);
  studentA = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentA, sectionA, yearId, { status: "active" });
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentA}, 'mother', true, true)`;
  const b = await createSecondStudent(inst.institutionId);
  ({ userId: userB, studentId: studentB, client: clientB } = b);
  await createEnrolment(inst.institutionId, studentB, sectionB, yearId, { status: "active" });

  const exam = (await one(sql`insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (${inst.institutionId}, ${yearId}, ${termId}, 'Half yearly', 'half_yearly', 'marks_entry') returning id`)).id as string;
  paperA = (await one(sql`insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, scheduled_at, duration_minutes, unit_ids)
    values (${inst.institutionId}, ${exam}, ${sectionA}, ${subjectId}, 80, 27, now() + interval '7 days', 90, ${[unitId]}) returning id`)).id as string;
  paperB = (await one(sql`insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, scheduled_at, duration_minutes)
    values (${inst.institutionId}, ${exam}, ${sectionB}, ${subjectId}, 80, 27, now() + interval '7 days', 60) returning id`)).id as string;
}, 120_000);

afterAll(async () => {
  await sql`delete from public.study_questions where institution_id = ${inst.institutionId}`;
  await sql`delete from public.notifications where institution_id = ${inst.institutionId}`;
  await sql`delete from public.exam_papers where institution_id = ${inst.institutionId}`;
  await sql`delete from public.exams where institution_id = ${inst.institutionId}`;
  await inst.cleanup();
  await other.cleanup();
  await admin.auth.admin.deleteUser(userB);
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 120_000);

const material = (userId: string, ownerRole: "student" | "teacher", extra: Record<string, unknown> = {}) => ({
  institution_id: inst.institutionId,
  user_id: userId,
  owner_role: ownerRole,
  format: "quick_summary",
  title: "Light summary",
  subject_id: subjectId,
  curriculum_unit_id: unitId,
  source_kind: "unit",
  content: { probe: true },
  ...extra,
});

async function insertId(client: SupabaseClient, table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await client.from(table).insert(row).select("id").single();
  if (error) throw new Error(`setup ${table}: ${error.message}`);
  return data.id as string;
}

/** A student's private curriculum file (0139 row, no stored object needed for RLS). */
async function privateFile(client: SupabaseClient, studentId: string, userId: string): Promise<string> {
  const { data, error } = await client
    .from("curriculum_materials")
    .insert({ institution_id: inst.institutionId, title: "My notes", owner_kind: "student", student_id: studentId, visibility: "private", created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(`setup file: ${error.message}`);
  return data.id as string;
}

const question = (studentId: string, sectionId: string, askedBy: string, extra: Record<string, unknown> = {}) => ({
  institution_id: inst.institutionId,
  student_id: studentId,
  class_section_id: sectionId,
  subject_id: subjectId,
  asked_by: askedBy,
  context_kind: "general",
  question: "Why does light bend?",
  ...extra,
});

describe("study from a file (0140 study_materials.source_material_id)", () => {
  it("a student may reference their own private file, never another student's", async () => {
    const mine = await privateFile(inst.clientAs("student"), studentA, inst.users.student.id);
    const theirs = await privateFile(clientB, studentB, userB);
    const own = await inst.clientAs("student").from("study_materials").insert(material(inst.users.student.id, "student", { source_kind: "file", source_material_id: mine }));
    expect(own.error).toBeNull();
    const stolen = await inst.clientAs("student").from("study_materials").insert(material(inst.users.student.id, "student", { source_kind: "file", source_material_id: theirs }));
    expect(stolen.error).not.toBeNull();
  });

  it("focus units and translations are bound to the same school", async () => {
    const cross = await inst.clientAs("student").from("study_materials").insert(material(inst.users.student.id, "student", { focus_unit_ids: [otherUnitId] }));
    expect(cross.error).not.toBeNull();
    const otherMaterial = (await one(sql`insert into public.study_materials (institution_id, user_id, owner_role, format, title, source_kind, content)
      values (${other.institutionId}, ${other.users.student.id}, 'student', 'quick_summary', 'Other', 'paste', '{"probe": true}'::jsonb) returning id`)).id as string;
    const crossVariant = await inst.clientAs("student").from("study_materials").insert(material(inst.users.student.id, "student", { language: "hi", variant_of: otherMaterial }));
    expect(crossVariant.error).not.toBeNull();
  });

  it("only one consent row per user, own rows only", async () => {
    const give = await inst.clientAs("student").from("study_ai_consents").insert({ institution_id: inst.institutionId, user_id: inst.users.student.id, kind: "file_reading" });
    expect(give.error).toBeNull();
    const forOther = await inst.clientAs("student").from("study_ai_consents").insert({ institution_id: inst.institutionId, user_id: userB, kind: "file_reading" });
    expect(forOther.error).not.toBeNull();
    expect((await clientB.from("study_ai_consents").select("user_id").eq("user_id", inst.users.student.id)).data).toEqual([]);
  });
});

describe("ask my teacher (0140 study_questions)", () => {
  it("the subject's teacher of the student's section reads and answers; the student is notified", async () => {
    const id = await insertId(inst.clientAs("student"), "study_questions", question(studentA, sectionA, inst.users.student.id));
    const teacherSees = await inst.clientAs("teacher").from("study_questions").select("id").eq("id", id);
    expect(teacherSees.data).toHaveLength(1);
    const notified = await sql`select 1 from public.notifications where recipient_user_id = ${inst.users.teacher.id} and type = 'study.question' and data ->> 'question_id' = ${id}`;
    expect(notified).toHaveLength(1);

    const answered = await inst.clientAs("teacher").from("study_questions").update({ answer: "It changes speed." }).eq("id", id).select("answered_by");
    expect(answered.error).toBeNull();
    expect(answered.data?.[0]?.answered_by).toBe(inst.users.teacher.id);
    const told = await sql`select 1 from public.notifications where recipient_user_id = ${inst.users.student.id} and type = 'study.answer' and data ->> 'question_id' = ${id}`;
    expect(told).toHaveLength(1);
  });

  it("a teacher cannot read or answer a question from a section they do not teach in that subject", async () => {
    const id = await insertId(clientB, "study_questions", question(studentB, sectionB, userB));
    expect((await inst.clientAs("teacher").from("study_questions").select("id").eq("id", id)).data).toEqual([]);
    const update = await inst.clientAs("teacher").from("study_questions").update({ answer: "Hijack" }).eq("id", id).select("id");
    expect(update.data ?? []).toEqual([]);
    expect((await sql`select answer from public.study_questions where id = ${id}`)[0]!.answer).toBeNull();
  });

  it("a student asks only for themselves, in their own section, about a subject taught there; cannot answer", async () => {
    const asB = await inst.clientAs("student").from("study_questions").insert(question(studentB, sectionB, inst.users.student.id));
    expect(asB.error).not.toBeNull();
    const wrongSection = await inst.clientAs("student").from("study_questions").insert(question(studentA, sectionB, inst.users.student.id));
    expect(wrongSection.error).not.toBeNull();
    const preAnswered = await inst.clientAs("student").from("study_questions").insert(question(studentA, sectionA, inst.users.student.id, { answer: "x", answered_by: inst.users.student.id, answered_at: new Date().toISOString() }));
    expect(preAnswered.error).not.toBeNull();
    const id = await insertId(inst.clientAs("student"), "study_questions", question(studentA, sectionA, inst.users.student.id));
    const selfAnswer = await inst.clientAs("student").from("study_questions").update({ answer: "Mine" }).eq("id", id).select("id");
    expect(selfAnswer.data ?? []).toEqual([]);
  });

  it("the guardian reads their child's questions only; student B and other schools see none", async () => {
    const id = await insertId(inst.clientAs("student"), "study_questions", question(studentA, sectionA, inst.users.student.id));
    const idB = await insertId(clientB, "study_questions", question(studentB, sectionB, userB));
    const g = inst.clientAs("guardian");
    expect((await g.from("study_questions").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await g.from("study_questions").select("id").eq("id", idB)).data).toEqual([]);
    expect((await clientB.from("study_questions").select("id").eq("id", id)).data).toEqual([]);
    for (const role of ["teacher", "principal", "guardian", "student"] as const) {
      expect((await other.clientAs(role).from("study_questions").select("id").eq("id", id)).data).toEqual([]);
    }
    // No leader branch: a study conversation stays between the student, their teacher and their family.
    expect((await inst.clientAs("principal").from("study_questions").select("id").eq("id", id)).data).toEqual([]);
  });

  it("another school's subject cannot be used", async () => {
    const cross = await inst.clientAs("student").from("study_questions").insert(question(studentA, sectionA, inst.users.student.id, { subject_id: otherSubjectId }));
    expect(cross.error).not.toBeNull();
  });
});

describe("guardian view (0138 reads the 0140 page relies on)", () => {
  it("the guardian reads the child's plan and attempts, not student B's, and never the child's materials", async () => {
    const planA = await insertId(inst.clientAs("student"), "study_plans", {
      institution_id: inst.institutionId, student_id: studentA, title: "Plan", start_date: "2026-11-11", target_date: "2026-11-30", minutes_per_day: 30, items: [],
    });
    const planB = await insertId(clientB, "study_plans", {
      institution_id: inst.institutionId, student_id: studentB, title: "Plan B", start_date: "2026-11-11", target_date: "2026-11-30", minutes_per_day: 30, items: [],
    });
    const mat = await insertId(inst.clientAs("student"), "study_materials", material(inst.users.student.id, "student"));
    const g = inst.clientAs("guardian");
    expect((await g.from("study_plans").select("id").eq("id", planA)).data).toHaveLength(1);
    expect((await g.from("study_plans").select("id").eq("id", planB)).data).toEqual([]);
    expect((await g.from("study_materials").select("id").eq("id", mat)).data).toEqual([]);
  });
});

describe("mock exams (0140)", () => {
  it("a student saves a mock exam and records a practice attempt on it", async () => {
    const mock = await insertId(inst.clientAs("student"), "study_materials", material(inst.users.student.id, "student", { format: "mock_exam", source_kind: "mock_exam", focus_unit_ids: [unitId] }));
    const attempt = await inst.clientAs("student").from("study_quiz_attempts").insert({
      institution_id: inst.institutionId, student_id: studentA, material_id: mock, title: "Mock exam: Light", difficulty: "medium",
      questions: [{ type: "true_false", stem: "Light bends.", answer: true }], answers: [true], auto_score: 1, auto_max: 1,
    });
    expect(attempt.error).toBeNull();
    const teacherMock = await inst.clientAs("teacher").from("study_materials").insert(material(inst.users.teacher.id, "teacher", { format: "mock_exam", source_kind: "mock_exam" }));
    expect(teacherMock.error).not.toBeNull();
  });

  it("my_exam_paper_scope returns the student's own section's paper only", async () => {
    const own = await inst.clientAs("student").rpc("my_exam_paper_scope", { p_paper_id: paperA });
    expect(own.error).toBeNull();
    expect(own.data).toEqual([expect.objectContaining({ paper_id: paperA, subject_id: subjectId, unit_ids: [unitId], duration_minutes: 90 })]);
    expect((await inst.clientAs("student").rpc("my_exam_paper_scope", { p_paper_id: paperB })).data).toEqual([]);
    expect((await other.clientAs("student").rpc("my_exam_paper_scope", { p_paper_id: paperA })).data).toEqual([]);
    expect((await inst.clientAs("guardian").rpc("my_exam_paper_scope", { p_paper_id: paperA })).data).toHaveLength(1);
  });
});

describe("worksheets and homework (0140)", () => {
  const assignment = (sectionId: string, studyMaterialId: string | null) => ({
    institution_id: inst.institutionId,
    class_section_id: sectionId,
    subject_id: subjectId,
    title: "Homework",
    created_by: "",
    study_material_id: studyMaterialId,
  });
  let teacherStaff: string;
  beforeAll(async () => {
    teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  });

  it("only teachers own worksheets, and a worksheet is never shared to a section", async () => {
    const studentWs = await inst.clientAs("student").from("study_materials").insert(material(inst.users.student.id, "student", { format: "worksheet" }));
    expect(studentWs.error).not.toBeNull();
    const ws = await insertId(inst.clientAs("teacher"), "study_materials", material(inst.users.teacher.id, "teacher", { format: "worksheet" }));
    const share = await inst.clientAs("teacher").from("study_material_sections").insert({ material_id: ws, institution_id: inst.institutionId, class_section_id: sectionA });
    expect(share.error).not.toBeNull();
  });

  it("homework links a teacher's own material in a section they teach; not another's material, a worksheet, or an untaught section", async () => {
    const mine = await insertId(inst.clientAs("teacher"), "study_materials", material(inst.users.teacher.id, "teacher"));
    const ok = await inst.clientAs("teacher").from("assignments").insert({ ...assignment(sectionA, mine), created_by: teacherStaff }).select("id, status").single();
    expect(ok.error).toBeNull();
    expect(ok.data?.status).toBe("draft");

    const untaught = await inst.clientAs("teacher").from("assignments").insert({ ...assignment(sectionB, mine), created_by: teacherStaff });
    expect(untaught.error).not.toBeNull();

    const studentMat = await insertId(inst.clientAs("student"), "study_materials", material(inst.users.student.id, "student"));
    const notMine = await inst.clientAs("teacher").from("assignments").insert({ ...assignment(sectionA, studentMat), created_by: teacherStaff });
    expect(notMine.error).not.toBeNull();

    const ws = await insertId(inst.clientAs("teacher"), "study_materials", material(inst.users.teacher.id, "teacher", { format: "worksheet" }));
    const wsLink = await inst.clientAs("teacher").from("assignments").insert({ ...assignment(sectionA, ws), created_by: teacherStaff });
    expect(wsLink.error).not.toBeNull();

    const relink = await inst.clientAs("teacher").from("assignments").update({ study_material_id: studentMat }).eq("id", ok.data!.id).select("id");
    expect(relink.error).not.toBeNull();
  });
});

describe("scoped study chats (0140 study_items.scope)", () => {
  it("a student's scoped chat is theirs alone: not the guardian, the teacher or student B", async () => {
    const id = await insertId(inst.clientAs("student"), "study_items", {
      institution_id: inst.institutionId, user_id: inst.users.student.id, kind: "chat", title: "Light chapters", content: { messages: [] }, scope: { subjectIds: [subjectId], unitIds: [unitId] },
    });
    for (const client of [inst.clientAs("guardian"), inst.clientAs("teacher"), clientB]) {
      expect((await client.from("study_items").select("id").eq("id", id)).data).toEqual([]);
    }
    const oversize = await inst.clientAs("student").from("study_items").insert({
      institution_id: inst.institutionId, user_id: inst.users.student.id, kind: "chat", title: "Big", content: { messages: [] }, scope: { goal: "x".repeat(9000) },
    });
    expect(oversize.error).not.toBeNull();
  });

  it("study time can carry a unit of the same school only", async () => {
    const ok = await inst.clientAs("student").from("study_sessions").insert({ institution_id: inst.institutionId, student_id: studentA, activity: "reading", minutes: 10, curriculum_unit_id: unitId });
    expect(ok.error).toBeNull();
    const cross = await inst.clientAs("student").from("study_sessions").insert({ institution_id: inst.institutionId, student_id: studentA, activity: "reading", minutes: 10, curriculum_unit_id: otherUnitId });
    expect(cross.error).not.toBeNull();
  });
});
