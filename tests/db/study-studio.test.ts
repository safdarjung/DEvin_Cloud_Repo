// 0138 — study studio RLS: private student material, teacher sharing to taught
// sections only, per-student rows (decks, attempts, plans, sessions) visible
// to the student, linked guardians and leaders, teacher engagement reads only
// on their own shared material, and no cross-school reads or writes.
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyStudyReminders } from "@/modules/jobs/handlers/notify.study_reminders";
import type { JobRow } from "@/modules/jobs/types";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);

let inst: TestInstitution;
let other: TestInstitution;
let subjectId: string;
let otherSubjectId: string;
let unitId: string;
let sectionA: string; // taught by the fixture teacher; student A is enrolled
let sectionB: string; // taught by nobody; student B is enrolled
let studentA: string;
let studentB: string;
let userB: string;
let clientB: SupabaseClient;

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

/** A second signed-in student in `inst` (the role fixture creates one per role). */
async function createSecondStudent(institutionId: string): Promise<{ userId: string; studentId: string; client: SupabaseClient }> {
  const email = `test-study-b-${crypto.randomUUID()}@test.coolskool.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const student = await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-B-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other') returning id`);
  await sql`insert into public.memberships (institution_id, user_id, role, student_id) values (${institutionId}, ${data.user.id}, 'student', ${student.id})`;
  const client = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, studentId: student.id as string, client };
}

beforeAll(async () => {
  inst = await createTestInstitution("study");
  other = await createTestInstitution("study-x");
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VII" });
  subjectId = await createSubject(inst.institutionId, { name: "Science" });
  otherSubjectId = await createSubject(other.institutionId, { name: "Science" });
  unitId = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence)
    values (${inst.institutionId}, ${subjectId}, ${gradeId}, 'Light', 'Reflection and refraction.', 1) returning id`)).id as string;
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff });
  sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  studentA = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentA, sectionA, yearId, { status: "active" });
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentA}, 'mother', true, true)`;
  const b = await createSecondStudent(inst.institutionId);
  ({ userId: userB, studentId: studentB, client: clientB } = b);
  await createEnrolment(inst.institutionId, studentB, sectionB, yearId, { status: "active" });
}, 120_000);

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await admin.auth.admin.deleteUser(userB);
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 120_000);

type Format = "quick_summary" | "flashcards" | "quiz";
const material = (userId: string, ownerRole: "student" | "teacher", format: Format = "quick_summary", extra: Record<string, unknown> = {}) => ({
  institution_id: inst.institutionId,
  user_id: userId,
  owner_role: ownerRole,
  format,
  title: `Light — ${format}`,
  subject_id: subjectId,
  curriculum_unit_id: unitId,
  source_kind: "unit",
  content: { probe: true },
  ...extra,
});

async function insertMaterial(client: SupabaseClient, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await client.from("study_materials").insert(row).select("id").single();
  if (error) throw new Error(`setup: ${error.message}`);
  return data.id as string;
}

const visible = async (client: SupabaseClient, table: string, column: string, value: string) =>
  ((await client.from(table).select(column).eq(column, value)).data ?? []).length;

const plan = (studentId: string, extra: Record<string, unknown> = {}) => ({
  institution_id: inst.institutionId,
  student_id: studentId,
  title: "Science test plan",
  start_date: "2026-11-11",
  target_date: "2026-11-20",
  minutes_per_day: 45,
  items: [],
  ...extra,
});

const attempt = (studentId: string, extra: Record<string, unknown> = {}) => ({
  institution_id: inst.institutionId,
  student_id: studentId,
  title: "Light quiz",
  difficulty: "medium",
  questions: [{ type: "true_false", stem: "Light bends in water.", answer: true }],
  answers: [true],
  auto_score: 1,
  auto_max: 1,
  ...extra,
});

describe("study studio RLS (0138)", () => {
  it("a student's own material is private: not student B, the guardian, the teacher or leaders", async () => {
    const id = await insertMaterial(inst.clientAs("student"), material(inst.users.student.id, "student"));
    expect(await visible(inst.clientAs("student"), "study_materials", "id", id)).toBe(1);
    expect(await visible(clientB, "study_materials", "id", id)).toBe(0);
    for (const role of ["guardian", "teacher", "principal", "admin", "owner"] as const) {
      expect(await visible(inst.clientAs(role), "study_materials", "id", id)).toBe(0);
    }
  });

  it("a student cannot save material as another user, as a teacher, or with another school's subject", async () => {
    const asOther = await inst.clientAs("student").from("study_materials").insert(material(userB, "student"));
    expect(asOther.error).not.toBeNull();
    const asTeacher = await inst.clientAs("student").from("study_materials").insert(material(inst.users.student.id, "teacher"));
    expect(asTeacher.error).not.toBeNull();
    const crossSubject = await inst.clientAs("student").from("study_materials").insert(material(inst.users.student.id, "student", "quick_summary", { subject_id: otherSubjectId }));
    expect(crossSubject.error).not.toBeNull();
    const guardian = await inst.clientAs("guardian").from("study_materials").insert(material(inst.users.guardian.id, "student"));
    expect(guardian.error).not.toBeNull();
  });

  it("a teacher shares only to a section they teach; exactly that section's enrolled students see it", async () => {
    const id = await insertMaterial(inst.clientAs("teacher"), material(inst.users.teacher.id, "teacher"));
    const untaught = await inst.clientAs("teacher").from("study_material_sections").insert({ material_id: id, institution_id: inst.institutionId, class_section_id: sectionB });
    expect(untaught.error).not.toBeNull();
    expect(await visible(clientB, "study_materials", "id", id)).toBe(0);
    expect(await visible(inst.clientAs("student"), "study_materials", "id", id)).toBe(0);

    const taught = await inst.clientAs("teacher").from("study_material_sections").insert({ material_id: id, institution_id: inst.institutionId, class_section_id: sectionA });
    expect(taught.error).toBeNull();
    expect(await visible(inst.clientAs("student"), "study_materials", "id", id)).toBe(1);
    expect(await visible(inst.clientAs("student"), "study_material_sections", "material_id", id)).toBe(1);
    expect(await visible(clientB, "study_materials", "id", id)).toBe(0);
    expect(await visible(inst.clientAs("guardian"), "study_materials", "id", id)).toBe(0);
    expect(await visible(inst.clientAs("principal"), "study_materials", "id", id)).toBe(1);

    // Students cannot widen the audience or edit the teacher's material.
    const studentShare = await inst.clientAs("student").from("study_material_sections").insert({ material_id: id, institution_id: inst.institutionId, class_section_id: sectionB });
    expect(studentShare.error).not.toBeNull();
    await inst.clientAs("student").from("study_materials").update({ title: "Hijacked" }).eq("id", id);
    expect((await one(sql`select title from public.study_materials where id = ${id}`)).title).toBe("Light — quick_summary");
  });

  it("a teacher cannot share another teacher's or a student's material", async () => {
    const own = await insertMaterial(inst.clientAs("student"), material(inst.users.student.id, "student"));
    const share = await inst.clientAs("teacher").from("study_material_sections").insert({ material_id: own, institution_id: inst.institutionId, class_section_id: sectionA });
    expect(share.error).not.toBeNull();
  });

  it("decks, attempts, plans and sessions: student B never sees student A's rows; the guardian sees only the child's", async () => {
    const deck = await insertMaterial(inst.clientAs("student"), material(inst.users.student.id, "student", "flashcards"));
    const progress = await inst.clientAs("student").from("study_deck_progress").insert({ material_id: deck, institution_id: inst.institutionId, student_id: studentA, state: { c1: { box: 2 } }, reviews: 1 });
    expect(progress.error).toBeNull();
    const a = await inst.clientAs("student").from("study_quiz_attempts").insert(attempt(studentA)).select("id").single();
    expect(a.error).toBeNull();
    const p = await inst.clientAs("student").from("study_plans").insert(plan(studentA)).select("id").single();
    expect(p.error).toBeNull();
    const s = await inst.clientAs("student").from("study_sessions").insert({ institution_id: inst.institutionId, student_id: studentA, activity: "flashcards", minutes: 12 });
    expect(s.error).toBeNull();
    const pb = await clientB.from("study_plans").insert(plan(studentB)).select("id").single();
    expect(pb.error).toBeNull();

    for (const [table, column] of [["study_deck_progress", "student_id"], ["study_quiz_attempts", "student_id"], ["study_plans", "student_id"], ["study_sessions", "student_id"]] as const) {
      expect(await visible(clientB, table, column, studentA)).toBe(0);
      expect(await visible(inst.clientAs("guardian"), table, column, studentA)).toBeGreaterThan(0);
    }
    expect(await visible(inst.clientAs("guardian"), "study_plans", "student_id", studentB)).toBe(0);
    // Plans stay with the family: no staff read.
    for (const role of ["teacher", "principal"] as const) expect(await visible(inst.clientAs(role), "study_plans", "student_id", studentA)).toBe(0);
    // Student B's deck is not student A's to review, even by id.
    expect(await visible(clientB, "study_materials", "id", deck)).toBe(0);
    const foreignReview = await clientB.from("study_deck_progress").insert({ material_id: deck, institution_id: inst.institutionId, student_id: studentB });
    expect(foreignReview.error).not.toBeNull();
  });

  it("a student cannot write rows for another student; attempts are insert-only; guardians cannot write plans", async () => {
    const forB = await inst.clientAs("student").from("study_plans").insert(plan(studentB));
    expect(forB.error).not.toBeNull();
    const attemptForB = await inst.clientAs("student").from("study_quiz_attempts").insert(attempt(studentB));
    expect(attemptForB.error).not.toBeNull();
    const byGuardian = await inst.clientAs("guardian").from("study_plans").insert(plan(studentA, { title: "Guardian plan" }));
    expect(byGuardian.error).not.toBeNull();
    const created = await inst.clientAs("student").from("study_quiz_attempts").insert(attempt(studentA, { title: "Immutable" })).select("id").single();
    expect(created.error).toBeNull();
    const edit = await inst.clientAs("student").from("study_quiz_attempts").update({ auto_score: 0 }).eq("id", created.data!.id);
    expect(edit.error).not.toBeNull();
    const overMax = await inst.clientAs("student").from("study_quiz_attempts").insert(attempt(studentA, { auto_score: 5, auto_max: 1 }));
    expect(overMax.error).not.toBeNull();
  });

  it("a teacher reads attempts only on their own shared quiz, for students they teach, never private practice", async () => {
    const quiz = await insertMaterial(inst.clientAs("teacher"), material(inst.users.teacher.id, "teacher", "quiz"));
    await inst.clientAs("teacher").from("study_material_sections").insert({ material_id: quiz, institution_id: inst.institutionId, class_section_id: sectionA });
    const shared = await inst.clientAs("student").from("study_quiz_attempts").insert(attempt(studentA, { material_id: quiz, title: "Shared quiz" })).select("id").single();
    expect(shared.error).toBeNull();
    const privateAttempt = await inst.clientAs("student").from("study_quiz_attempts").insert(attempt(studentA, { title: "Private" })).select("id").single();
    expect(privateAttempt.error).toBeNull();
    expect(await visible(inst.clientAs("teacher"), "study_quiz_attempts", "id", shared.data!.id)).toBe(1);
    expect(await visible(inst.clientAs("teacher"), "study_quiz_attempts", "id", privateAttempt.data!.id)).toBe(0);
    // Student B (not enrolled in the audience) cannot attach an attempt to it.
    const outsider = await clientB.from("study_quiz_attempts").insert(attempt(studentB, { material_id: quiz }));
    expect(outsider.error).not.toBeNull();
  });

  it("school B cannot read or write school A's study rows", async () => {
    const teacherMaterial = await insertMaterial(inst.clientAs("teacher"), material(inst.users.teacher.id, "teacher"));
    for (const role of ["owner", "principal", "teacher", "student", "guardian"] as const) {
      const c = other.clientAs(role);
      expect(((await c.from("study_materials").select("id").eq("institution_id", inst.institutionId)).data ?? []).length).toBe(0);
      expect(((await c.from("study_quiz_attempts").select("id").eq("institution_id", inst.institutionId)).data ?? []).length).toBe(0);
      expect(((await c.from("study_plans").select("id").eq("institution_id", inst.institutionId)).data ?? []).length).toBe(0);
    }
    const crossInsert = await other.clientAs("student").from("study_materials").insert(material(other.users.student.id, "student"));
    expect(crossInsert.error).not.toBeNull();
    const crossShare = await other.clientAs("teacher").from("study_material_sections").insert({ material_id: teacherMaterial, institution_id: inst.institutionId, class_section_id: sectionA });
    expect(crossShare.error).not.toBeNull();
    const crossPlan = await other.clientAs("student").from("study_plans").insert(plan(studentA));
    expect(crossPlan.error).not.toBeNull();
  });

  it("the daily reminder job notifies a studio student in-app once per day (cards due), and no one without due work", async () => {
    const deck = await insertMaterial(
      inst.clientAs("student"),
      material(inst.users.student.id, "student", "flashcards", { content: { cards: [{ id: "c1", front: "Mirror", back: "Reflects light" }] } }),
    );
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const progress = await inst.clientAs("student").from("study_deck_progress").insert({
      material_id: deck, institution_id: inst.institutionId, student_id: studentA, state: { c1: { box: 1, due: yesterday, reps: 1, lapses: 0, last: yesterday } }, reviews: 1,
    });
    expect(progress.error).toBeNull();
    const job = { id: crypto.randomUUID(), institution_id: inst.institutionId, type: "notify.study_reminders", payload: {} } as JobRow;
    await notifyStudyReminders(job, { admin });
    await notifyStudyReminders(job, { admin });
    const mine = await sql`select body from public.notifications where institution_id = ${inst.institutionId} and type = 'study_reminder' and recipient_user_id = ${inst.users.student.id}`;
    expect(mine).toHaveLength(1);
    expect(mine[0]!.body).toContain("1 flashcard due");
    const others = await sql`select 1 from public.notifications where institution_id = ${inst.institutionId} and type = 'study_reminder' and recipient_user_id <> ${inst.users.student.id}`;
    expect(others).toHaveLength(0);
  });
});
