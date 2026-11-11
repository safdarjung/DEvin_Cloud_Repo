// 0139 — NCERT catalogue (global, read-only), per-school textbook mapping,
// unit -> chapter links, and curriculum materials (the school's own files in
// tenant-docs): class materials reach students of that grade+subject and
// their guardians; a student's private file reaches only them and their
// guardian (row, documents row and storage object); suggest -> approve makes
// it a class material; teachers delete only within subjects they teach;
// nothing crosses schools.
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  deleteMaterial,
  requestMaterialUpload,
  reviewMaterial,
  suggestMaterial,
} from "@/modules/textbooks/materials.actions";
import { suggestNcertBooks } from "@/modules/textbooks/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, createSubjectAssignment } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
const BUCKET = "tenant-docs";
const PDF = new TextEncoder().encode("%PDF-1.4\n% test\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

let inst: TestInstitution;
let other: TestInstitution;
let gradeVI: string;
let gradeVII: string;
let maths: string;
let science: string;
let unitMaths: string;
let sectionVIA: string;
let sectionVIB: string;
let studentA: string;
const extra: { userId: string }[] = [];
let studentB: { userId: string; studentId: string; client: SupabaseClient };
let studentC: { userId: string; studentId: string; client: SupabaseClient }; // Grade VII
let teacher2: { userId: string; staffId: string; client: SupabaseClient }; // teaches Science in VI-A only

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function newUser(tag: string): Promise<{ userId: string; email: string; password: string }> {
  const email = `test-tbk-${tag}-${crypto.randomUUID()}@test.coolskool.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  extra.push({ userId: data.user.id });
  return { userId: data.user.id, email, password };
}

async function extraStudent(sectionId: string, yearId: string, tag: string) {
  const u = await newUser(tag);
  const student = await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${tag}-${crypto.randomUUID().slice(0, 6)}`}, ${tag}, '2014-01-01', 'other') returning id`);
  await sql`insert into public.memberships (institution_id, user_id, role, student_id) values (${inst.institutionId}, ${u.userId}, 'student', ${student.id})`;
  await createEnrolment(inst.institutionId, student.id as string, sectionId, yearId);
  return { userId: u.userId, studentId: student.id as string, client: await signIn(u.email, u.password) };
}

/** Material + pending documents row + object + activate, all as `client` under RLS. */
async function upload(
  client: SupabaseClient,
  userId: string,
  m: { owner_kind: "staff" | "student"; visibility: "class" | "private"; student_id?: string; grade_id?: string | null; subject_id?: string | null; curriculum_unit_id?: string | null },
): Promise<{ materialId: string; documentId: string; path: string }> {
  const materialId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const path = `${inst.institutionId}/curriculum_material/${materialId}/${documentId}.pdf`;
  const ins = await client.from("curriculum_materials").insert({
    id: materialId, institution_id: inst.institutionId, title: "Notes", created_by: userId,
    owner_kind: m.owner_kind, visibility: m.visibility, student_id: m.student_id ?? null,
    grade_id: m.grade_id ?? null, subject_id: m.subject_id ?? null, curriculum_unit_id: m.curriculum_unit_id ?? null,
  });
  if (ins.error) throw new Error(`material insert: ${ins.error.message}`);
  const doc = await client.from("documents").insert({
    id: documentId, institution_id: inst.institutionId, entity_type: "curriculum_material", entity_id: materialId,
    kind: "curriculum", file_name: "notes.pdf", mime: "application/pdf", size_bytes: PDF.byteLength, path, created_by: userId,
  });
  if (doc.error) throw new Error(`document insert: ${doc.error.message}`);
  const up = await client.storage.from(BUCKET).upload(path, PDF, { contentType: "application/pdf" });
  if (up.error) throw new Error(`object upload: ${up.error.message}`);
  const act = await client.from("documents").update({ status: "active" }).eq("id", documentId).select("id");
  if (act.error || act.data?.length !== 1) throw new Error(`activate: ${act.error?.message ?? "0 rows"}`);
  return { materialId, documentId, path };
}

const sees = async (client: SupabaseClient, materialId: string) => {
  const { data, error } = await client.from("curriculum_materials").select("id").eq("id", materialId);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
};
const seesDoc = async (client: SupabaseClient, documentId: string) => {
  const { data } = await client.from("documents").select("id").eq("id", documentId);
  return (data ?? []).length === 1;
};
const canFetch = async (client: SupabaseClient, path: string) => {
  const { data, error } = await client.storage.from(BUCKET).download(path);
  return !error && data !== null;
};

beforeAll(async () => {
  inst = await createTestInstitution("tbk");
  other = await createTestInstitution("tbk-x");
  const yearId = await createAcademicYear(inst.institutionId);
  gradeVI = await createGrade(inst.institutionId, { code: "VI", displayName: "Class 6", sortKey: 6 });
  gradeVII = await createGrade(inst.institutionId, { code: "VII", displayName: "Class 7", sortKey: 7 });
  maths = await createSubject(inst.institutionId, { name: "Maths" });
  science = await createSubject(inst.institutionId, { name: "Science" });
  unitMaths = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${inst.institutionId}, ${maths}, ${gradeVI}, 'Patterns', 1) returning id`)).id as string;
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  sectionVIA = await createClassSection(inst.institutionId, gradeVI, yearId, { name: "A" });
  sectionVIB = await createClassSection(inst.institutionId, gradeVI, yearId, { name: "B" });
  const sectionVIIA = await createClassSection(inst.institutionId, gradeVII, yearId, { name: "A" });
  await createSubjectAssignment(inst.institutionId, sectionVIA, maths, teacherStaff);
  await createSubjectAssignment(inst.institutionId, sectionVIIA, maths, teacherStaff);

  const t2 = await newUser("teacher2");
  const staff2 = await one(sql`insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-T2-${crypto.randomUUID().slice(0, 6)}`}, 'Second Teacher', 'teacher') returning id`);
  await sql`insert into public.memberships (institution_id, user_id, role, staff_id) values (${inst.institutionId}, ${t2.userId}, 'teacher', ${staff2.id})`;
  await createSubjectAssignment(inst.institutionId, sectionVIA, science, staff2.id as string);
  teacher2 = { userId: t2.userId, staffId: staff2.id as string, client: await signIn(t2.email, t2.password) };

  studentA = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentA, sectionVIA, yearId);
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentA}, 'mother', true, true)`;
  studentB = await extraStudent(sectionVIA, yearId, "b");
  studentC = await extraStudent(sectionVIIA, yearId, "c");
}, 120_000);

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await Promise.all(extra.map((u) => admin.auth.admin.deleteUser(u.userId)));
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 120_000);

describe("ncert_textbooks catalogue", () => {
  it("is readable by members and not writable by anyone via PostgREST; anon reads nothing", async () => {
    for (const role of ["student", "guardian", "teacher", "admin"] as FixtureRole[]) {
      const { data, error } = await inst.clientAs(role).from("ncert_textbooks").select("code, verified").eq("code", "fegp1");
      expect(error).toBeNull();
      expect(data).toEqual([{ code: "fegp1", verified: true }]);
    }
    const { count } = await inst.clientAs("teacher").from("ncert_textbooks").select("code", { count: "exact", head: true });
    expect(count).toBe(391);
    const anon = await inst.clientAsAnon().from("ncert_textbooks").select("code").limit(1);
    expect(anon.error !== null || (anon.data ?? []).length === 0).toBe(true);
    for (const role of ["owner", "admin", "teacher", "student"] as FixtureRole[]) {
      const ins = await inst.clientAs(role).from("ncert_textbooks").insert({
        code: `zz${role.slice(0, 3)}1`, class_label: "6", class_level: 6, subject: "X", title: "X", medium: "English", chapters_count: 1,
        book_url: "https://ncert.nic.in/textbook.php?zzzz1=0-1", chapter_pdf_pattern: "https://ncert.nic.in/textbook/pdf/zzzz1{NN}.pdf", retrieved_on: "2026-11-11",
      });
      expect(ins.error).not.toBeNull();
      const upd = await inst.clientAs(role).from("ncert_textbooks").update({ title: "Hacked" }).eq("code", "fegp1").select("code");
      expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
      const del = await inst.clientAs(role).from("ncert_textbooks").delete().eq("code", "fegp1").select("code");
      expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    }
    expect((await one(sql`select title from public.ncert_textbooks where code = 'fegp1'`)).title).toBe("Ganita Prakash");
  });
});

describe("subject_textbooks mapping", () => {
  const row = (role: FixtureRole, grade: string, subject: string, code = "fegp1") => ({
    institution_id: inst.institutionId, grade_id: grade, subject_id: subject, ncert_code: code, created_by: inst.users[role].id,
  });

  it("leaders and the subject's teacher write; other teachers, students, guardians and other staff cannot", async () => {
    expect((await inst.clientAs("admin").from("subject_textbooks").insert(row("admin", gradeVI, maths, "fegp1"))).error).toBeNull();
    expect((await inst.clientAs("teacher").from("subject_textbooks").insert(row("teacher", gradeVII, maths, "gegp1"))).error).toBeNull();
    // Teaches Maths but not Science; teaches nothing in VI-B only matters by grade.
    expect((await inst.clientAs("teacher").from("subject_textbooks").insert(row("teacher", gradeVI, science, "fecu1"))).error).not.toBeNull();
    expect((await teacher2.client.from("subject_textbooks").insert({ ...row("teacher", gradeVI, maths, "fegp1"), created_by: teacher2.userId })).error).not.toBeNull();
    for (const role of ["student", "guardian", "accountant", "admissions"] as FixtureRole[]) {
      expect((await inst.clientAs(role).from("subject_textbooks").insert(row(role, gradeVI, maths, "fees1"))).error).not.toBeNull();
    }
    // Custom book: https only.
    const bad = await inst.clientAs("admin").from("subject_textbooks").insert({
      institution_id: inst.institutionId, grade_id: gradeVI, subject_id: maths, custom_title: "RS Aggarwal", custom_url: "javascript:alert(1)", created_by: inst.users.admin.id,
    });
    expect(bad.error).not.toBeNull();
  });

  it("every member reads the mapping; another school neither reads nor binds to it", async () => {
    for (const role of ["student", "guardian", "teacher", "accountant"] as FixtureRole[]) {
      const { data } = await inst.clientAs(role).from("subject_textbooks").select("id").eq("institution_id", inst.institutionId);
      expect((data ?? []).length).toBeGreaterThan(0);
    }
    const { data: x } = await other.clientAs("admin").from("subject_textbooks").select("id").eq("institution_id", inst.institutionId);
    expect(x).toEqual([]);
    const cross = await other.clientAs("admin").from("subject_textbooks").insert({
      institution_id: other.institutionId, grade_id: gradeVI, subject_id: maths, ncert_code: "fegp1", created_by: other.users.admin.id,
    });
    expect(cross.error).not.toBeNull();
  });

  it("a unit links one chapter of a mapped book; out-of-range chapters fail; students of that grade read it", async () => {
    const book = (await one(sql`select id from public.subject_textbooks where institution_id = ${inst.institutionId} and grade_id = ${gradeVI} and subject_id = ${maths} and ncert_code = 'fegp1'`)).id as string;
    const link = { curriculum_unit_id: unitMaths, institution_id: inst.institutionId, grade_id: gradeVI, subject_id: maths, subject_textbook_id: book };
    expect((await inst.clientAs("teacher").from("curriculum_unit_chapters").insert({ ...link, chapter_no: 99, created_by: inst.users.teacher.id })).error).not.toBeNull();
    expect((await teacher2.client.from("curriculum_unit_chapters").insert({ ...link, chapter_no: 4, created_by: teacher2.userId })).error).not.toBeNull();
    expect((await inst.clientAs("teacher").from("curriculum_unit_chapters").insert({ ...link, chapter_no: 4, created_by: inst.users.teacher.id })).error).toBeNull();
    const { data: a } = await inst.clientAs("student").from("curriculum_unit_chapters").select("chapter_no").eq("curriculum_unit_id", unitMaths);
    expect(a).toEqual([{ chapter_no: 4 }]);
    const { data: c } = await studentC.client.from("curriculum_unit_chapters").select("chapter_no").eq("curriculum_unit_id", unitMaths);
    expect(c).toEqual([]);
  });
});

describe("curriculum materials", () => {
  let classFile: { materialId: string; documentId: string; path: string };
  let privateFile: { materialId: string; documentId: string; path: string };

  it("a class material reaches students of that grade+subject and their guardians, not another grade", async () => {
    classFile = await upload(inst.clientAs("teacher"), inst.users.teacher.id, { owner_kind: "staff", visibility: "class", grade_id: gradeVI, subject_id: maths, curriculum_unit_id: unitMaths });
    for (const client of [inst.clientAs("student"), studentB.client, inst.clientAs("guardian"), teacher2.client, inst.clientAs("accountant")]) {
      expect(await sees(client, classFile.materialId)).toBe(true);
      expect(await seesDoc(client, classFile.documentId)).toBe(true);
    }
    expect(await canFetch(inst.clientAs("student"), classFile.path)).toBe(true);
    expect(await sees(studentC.client, classFile.materialId)).toBe(false);
    expect(await canFetch(studentC.client, classFile.path)).toBe(false);
  });

  it("a teacher cannot post a class material to a subject they do not teach", async () => {
    await expect(upload(teacher2.client, teacher2.userId, { owner_kind: "staff", visibility: "class", grade_id: gradeVI, subject_id: maths })).rejects.toThrow(/material insert/);
  });

  it("student B cannot see student A's private file row, document or storage object; A's guardian can; staff cannot", async () => {
    privateFile = await upload(inst.clientAs("student"), inst.users.student.id, { owner_kind: "student", visibility: "private", student_id: studentA, grade_id: gradeVI, subject_id: maths });
    expect(await sees(inst.clientAs("student"), privateFile.materialId)).toBe(true);
    expect(await canFetch(inst.clientAs("student"), privateFile.path)).toBe(true);
    expect(await sees(inst.clientAs("guardian"), privateFile.materialId)).toBe(true);
    expect(await canFetch(inst.clientAs("guardian"), privateFile.path)).toBe(true);
    for (const client of [studentB.client, inst.clientAs("teacher"), inst.clientAs("admin"), inst.clientAs("owner")]) {
      expect(await sees(client, privateFile.materialId)).toBe(false);
      expect(await seesDoc(client, privateFile.documentId)).toBe(false);
      expect(await canFetch(client, privateFile.path)).toBe(false);
      const signed = await client.storage.from(BUCKET).createSignedUrl(privateFile.path, 60);
      expect(signed.error).not.toBeNull();
    }
  });

  it("a guardian cannot write; a student cannot share a file with the class directly or file it under another student", async () => {
    const asGuardian = await inst.clientAs("guardian").from("curriculum_materials").insert({
      institution_id: inst.institutionId, title: "x", owner_kind: "student", student_id: studentA, visibility: "private", created_by: inst.users.guardian.id,
    });
    expect(asGuardian.error).not.toBeNull();
    const direct = await inst.clientAs("student").from("curriculum_materials").update({ visibility: "class" }).eq("id", privateFile.materialId).select("id");
    expect(direct.error).not.toBeNull();
    const forged = await inst.clientAs("student").from("curriculum_materials").insert({
      institution_id: inst.institutionId, title: "x", owner_kind: "student", student_id: studentB.studentId, visibility: "private", created_by: inst.users.student.id,
    });
    expect(forged.error).not.toBeNull();
  });

  it("teacher cannot delete another teacher's upload unless they teach that subject", async () => {
    const del = await teacher2.client.from("curriculum_materials").delete().eq("id", classFile.materialId).select("id");
    expect(del.data ?? []).toEqual([]);
    const sa = await createSubjectAssignment(inst.institutionId, sectionVIB, maths, teacher2.staffId);
    try {
      const del2 = await teacher2.client.from("curriculum_materials").delete().eq("id", classFile.materialId).select("id");
      expect(del2.error).toBeNull();
      expect(del2.data).toHaveLength(1);
    } finally {
      await sql`delete from public.subject_assignments where id = ${sa}`;
    }
  });

  it("school B reads none of school A's materials, documents or objects", async () => {
    for (const role of ["owner", "admin", "teacher", "student", "guardian"] as FixtureRole[]) {
      const { data } = await other.clientAs(role).from("curriculum_materials").select("id").eq("institution_id", inst.institutionId);
      expect(data).toEqual([]);
      expect(await canFetch(other.clientAs(role), privateFile.path)).toBe(false);
    }
  });
});

describe("actions: upload, suggest -> approve / decline, delete, Suggest NCERT books", () => {
  async function studentUpload(): Promise<string> {
    const req = await callAs(inst, "student", requestMaterialUpload, {
      fileName: "my-notes.pdf", mime: "application/pdf", sizeBytes: PDF.byteLength, target: { gradeId: gradeVI, subjectId: maths },
    });
    if (!req.ok) throw new Error(`${req.error.code} ${req.error.message}`);
    const up = await inst.clientAs("student").storage.from(BUCKET).uploadToSignedUrl(req.data.path, req.data.token, PDF, { contentType: "application/pdf" });
    if (up.error) throw up.error;
    await sql`update public.documents set status = 'active' where id = ${req.data.documentId}`;
    return req.data.materialId;
  }

  it("a student's suggestion reaches the subject teacher, who approves it into a class material; ownership stays", async () => {
    const id = await studentUpload();
    expect(await sees(studentB.client, id)).toBe(false);
    expect(await sees(inst.clientAs("teacher"), id)).toBe(false);
    expect((await callAs(inst, "student", suggestMaterial, { materialId: id, suggest: true })).ok).toBe(true);
    expect(await sees(inst.clientAs("teacher"), id)).toBe(true);
    expect(await sees(teacher2.client, id)).toBe(false);
    expect(await sees(studentB.client, id)).toBe(false);
    // Science teacher (no Maths) cannot approve; the Maths teacher can.
    expect((await callAs(inst, "teacher", reviewMaterial, { materialId: id, decision: "approve" })).ok).toBe(true);
    const row = await one(sql`select visibility, suggestion, owner_kind, student_id, created_by from public.curriculum_materials where id = ${id}`);
    expect(row).toMatchObject({ visibility: "class", suggestion: "approved", owner_kind: "student", student_id: studentA, created_by: inst.users.student.id });
    expect(await sees(studentB.client, id)).toBe(true);
  });

  it("a declined suggestion stays private (only the declining reviewer keeps sight of it until it is refiled)", async () => {
    const id = await studentUpload();
    expect((await callAs(inst, "student", suggestMaterial, { materialId: id, suggest: true })).ok).toBe(true);
    expect((await callAs(inst, "student", reviewMaterial, { materialId: id, decision: "approve" })).ok).toBe(false);
    expect((await callAs(inst, "teacher", reviewMaterial, { materialId: id, decision: "decline" })).ok).toBe(true);
    expect(await sees(studentB.client, id)).toBe(false);
    expect(await sees(inst.clientAs("admin"), id)).toBe(false);
    expect(await sees(inst.clientAs("teacher"), id)).toBe(true);
    expect((await callAs(inst, "student", suggestMaterial, { materialId: id, suggest: false })).ok).toBe(true);
    expect(await sees(inst.clientAs("teacher"), id)).toBe(false);
    expect((await callAs(inst, "student", deleteMaterial, { materialId: id })).ok).toBe(true);
    expect(await sees(inst.clientAs("student"), id)).toBe(false);
  });

  it("refuses a non-PDF/image mime and a size over 10 MB before any row is written", async () => {
    const before = (await one(sql`select count(*)::int as n from public.curriculum_materials where institution_id = ${inst.institutionId}`)).n;
    const exe = await callAs(inst, "teacher", requestMaterialUpload, { fileName: "x.exe", mime: "application/x-msdownload", sizeBytes: 10, target: { gradeId: gradeVI, subjectId: maths } } as never);
    expect(exe.ok).toBe(false);
    const big = await callAs(inst, "teacher", requestMaterialUpload, { fileName: "big.pdf", mime: "application/pdf", sizeBytes: 10485761, target: { gradeId: gradeVI, subjectId: maths } });
    expect(big.ok).toBe(false);
    expect((await one(sql`select count(*)::int as n from public.curriculum_materials where institution_id = ${inst.institutionId}`)).n).toBe(before);
  });

  it("Suggest NCERT books maps (grade, subject) pairs by class number and synonym, idempotently", async () => {
    const first = await callAs(inst, "admin", suggestNcertBooks, {});
    expect(first.ok).toBe(true);
    const codes = await sql`select st.ncert_code from public.subject_textbooks st where st.institution_id = ${inst.institutionId} and st.grade_id = ${gradeVI} and st.subject_id = ${science}`;
    expect(codes.map((r) => r.ncert_code)).toEqual(["fecu1"]);
    const again = await callAs(inst, "admin", suggestNcertBooks, {});
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.added).toBe(0);
    expect((await callAs(inst, "student", suggestNcertBooks, {})).ok).toBe(false);
  });
});
