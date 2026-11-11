// 0142 — a school's link and uploaded PDF on a textbook row (NCERT-mapped or
// custom): written by leaders and the subject's teacher only; read by staff
// and that grade+subject's students and guardians (row, documents row and
// storage object); a replaced or removed file is retired; PDF only; textbook
// PDFs may be up to 50 MB while every other document kind stays at 10 MB.
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { requestUpload } from "@/modules/documents/actions";
import { removeTextbook } from "@/modules/textbooks/actions";
import { confirmTextbookFile, getTextbookFileUrl, removeTextbookFile, requestTextbookFile, setTextbookLink } from "@/modules/textbooks/files.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, createSubjectAssignment } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
const BUCKET = "tenant-docs";
const MB = 1048576;
const pdfBytes = (size: number) => {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode("%PDF-1.4\n"));
  return b;
};
const PDF = pdfBytes(200);

let inst: TestInstitution;
let other: TestInstitution;
let gradeVI: string;
let gradeVII: string;
let maths: string;
let science: string;
let ncertBook: string;
let customBook: string;
const extra: { userId: string }[] = [];
let teacher2: { userId: string; client: SupabaseClient }; // teaches Science in VI only
let studentC: { client: SupabaseClient }; // Grade VII

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
async function newUser(tag: string) {
  const email = `test-tbf-${tag}-${crypto.randomUUID()}@test.coolskool.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  extra.push({ userId: data.user.id });
  return { userId: data.user.id, email, password };
}
const newBook = async (grade: string, subject: string, fields: Record<string, unknown>) =>
  (await one(sql`insert into public.subject_textbooks ${sql({ institution_id: inst.institutionId, grade_id: grade, subject_id: subject, created_by: inst.users.admin.id, ...fields })} returning id`)).id as string;

/** Request + PUT + confirm as `role` through the actions. */
async function uploadFile(role: "teacher" | "admin", textbookId: string, bytes: Uint8Array = PDF) {
  const req = await callAs(inst, role, requestTextbookFile, { textbookId, fileName: "book.pdf", sizeBytes: bytes.byteLength });
  if (!req.ok) return { req, done: null };
  const up = await inst.clientAs(role).storage.from(BUCKET).uploadToSignedUrl(req.data.path, req.data.token, bytes, { contentType: "application/pdf" });
  if (up.error) throw up.error;
  return { req, done: await callAs(inst, role, confirmTextbookFile, { textbookId }) };
}
const canFetch = async (client: SupabaseClient, path: string) => {
  const { data, error } = await client.storage.from(BUCKET).download(path);
  return !error && data !== null;
};
const docRows = async (textbookId: string, status: string) => (await sql`select id, path from public.documents where entity_type = 'subject_textbook' and entity_id = ${textbookId} and status = ${status}`);

beforeAll(async () => {
  inst = await createTestInstitution("tbf");
  other = await createTestInstitution("tbf-x");
  const yearId = await createAcademicYear(inst.institutionId);
  gradeVI = await createGrade(inst.institutionId, { code: "VI", displayName: "Class 6", sortKey: 6 });
  gradeVII = await createGrade(inst.institutionId, { code: "VII", displayName: "Class 7", sortKey: 7 });
  maths = await createSubject(inst.institutionId, { name: "Maths" });
  science = await createSubject(inst.institutionId, { name: "Science" });
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  const sectionVIA = await createClassSection(inst.institutionId, gradeVI, yearId, { name: "A" });
  const sectionVIIA = await createClassSection(inst.institutionId, gradeVII, yearId, { name: "A" });
  await createSubjectAssignment(inst.institutionId, sectionVIA, maths, teacherStaff);
  await createSubjectAssignment(inst.institutionId, sectionVIIA, maths, teacherStaff);

  const t2 = await newUser("teacher2");
  const staff2 = await one(sql`insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-T2-${crypto.randomUUID().slice(0, 6)}`}, 'Second Teacher', 'teacher') returning id`);
  await sql`insert into public.memberships (institution_id, user_id, role, staff_id) values (${inst.institutionId}, ${t2.userId}, 'teacher', ${staff2.id})`;
  await createSubjectAssignment(inst.institutionId, sectionVIA, science, staff2.id as string);
  teacher2 = { userId: t2.userId, client: await signIn(t2.email, t2.password) };

  const studentA = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentA, sectionVIA, yearId);
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentA}, 'mother', true, true)`;
  const uc = await newUser("c");
  const sc = await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-C-${crypto.randomUUID().slice(0, 6)}`}, 'C', '2014-01-01', 'other') returning id`);
  await sql`insert into public.memberships (institution_id, user_id, role, student_id) values (${inst.institutionId}, ${uc.userId}, 'student', ${sc.id})`;
  await createEnrolment(inst.institutionId, sc.id as string, sectionVIIA, yearId);
  studentC = { client: await signIn(uc.email, uc.password) };

  ncertBook = await newBook(gradeVI, maths, { ncert_code: "fegp1" });
  customBook = await newBook(gradeVI, maths, { custom_title: "RS Aggarwal" });
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

describe("school link", () => {
  it("the grade+subject's teacher sets and clears a link on an NCERT row (school_url) and a custom row (custom_url)", async () => {
    expect((await callAs(inst, "teacher", setTextbookLink, { textbookId: ncertBook, url: "https://school.example/maths6.pdf" })).ok).toBe(true);
    expect((await callAs(inst, "teacher", setTextbookLink, { textbookId: customBook, url: "https://publisher.example/rs" })).ok).toBe(true);
    expect(await one(sql`select school_url, ncert_code from public.subject_textbooks where id = ${ncertBook}`)).toMatchObject({ school_url: "https://school.example/maths6.pdf", ncert_code: "fegp1" });
    expect((await one(sql`select custom_url from public.subject_textbooks where id = ${customBook}`)).custom_url).toBe("https://publisher.example/rs");
    expect((await callAs(inst, "teacher", setTextbookLink, { textbookId: ncertBook, url: null })).ok).toBe(true);
    expect((await one(sql`select school_url from public.subject_textbooks where id = ${ncertBook}`)).school_url).toBeNull();
  });

  it("a teacher of another subject, a student and another school cannot change it; the database refuses non-https", async () => {
    const url = "https://evil.example/x";
    for (const client of [teacher2.client, inst.clientAs("student"), inst.clientAs("guardian"), other.clientAs("admin")]) {
      const r = await client.from("subject_textbooks").update({ school_url: url }).eq("id", ncertBook).select("id");
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
    expect((await one(sql`select school_url from public.subject_textbooks where id = ${ncertBook}`)).school_url).toBeNull();
    for (const bad of ["javascript:alert(1)", "http://example.com", "https://exa mple.com"]) {
      expect((await inst.clientAs("admin").from("subject_textbooks").update({ school_url: bad }).eq("id", ncertBook)).error, bad).not.toBeNull();
    }
  });
});

describe("school PDF", () => {
  it("the subject's teacher uploads a PDF to an NCERT-mapped and to a custom book", async () => {
    for (const book of [ncertBook, customBook]) {
      const { done } = await uploadFile("teacher", book);
      expect(done?.ok, JSON.stringify(done)).toBe(true);
      expect(await docRows(book, "active")).toHaveLength(1);
    }
  });

  it("students and guardians of that grade+subject and staff read it (action URL and the object); another grade and another school cannot", async () => {
    const path = (await docRows(ncertBook, "active"))[0]!.path as string;
    for (const client of [inst.clientAs("student"), inst.clientAs("guardian"), teacher2.client, inst.clientAs("accountant"), inst.clientAs("admin")]) {
      expect(await canFetch(client, path)).toBe(true);
    }
    const url = await callAs(inst, "student", getTextbookFileUrl, { textbookId: ncertBook });
    expect(url.ok).toBe(true);
    expect((await callAs(inst, "guardian", getTextbookFileUrl, { textbookId: ncertBook })).ok).toBe(true);

    expect(await canFetch(studentC.client, path)).toBe(false);
    expect((await studentC.client.storage.from(BUCKET).createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await studentC.client.from("documents").select("id").eq("entity_id", ncertBook)).data).toEqual([]);
    expect(await canFetch(other.clientAs("admin"), path)).toBe(false);
    expect((await other.clientAs("admin").from("documents").select("id").eq("entity_id", ncertBook)).data).toEqual([]);
  });

  it("a teacher of another subject and another school cannot request or write a file for it", async () => {
    const asT2 = await teacher2.client.from("documents").insert({
      institution_id: inst.institutionId, entity_type: "subject_textbook", entity_id: ncertBook, kind: "textbook", file_name: "x.pdf",
      mime: "application/pdf", size_bytes: 10, path: `${inst.institutionId}/subject_textbook/${ncertBook}/${crypto.randomUUID()}.pdf`, created_by: teacher2.userId,
    });
    expect(asT2.error).not.toBeNull();
    const asOther = await other.clientAs("admin").from("documents").insert({
      institution_id: other.institutionId, entity_type: "subject_textbook", entity_id: ncertBook, kind: "textbook", file_name: "x.pdf",
      mime: "application/pdf", size_bytes: 10, path: `${other.institutionId}/subject_textbook/${ncertBook}/${crypto.randomUUID()}.pdf`, created_by: other.users.admin.id,
    });
    expect(asOther.error).not.toBeNull();
    expect((await callAs(other, "admin", requestTextbookFile, { textbookId: ncertBook, fileName: "x.pdf", sizeBytes: 10 })).ok).toBe(false);
    for (const role of ["student", "guardian"] as const) {
      expect((await callAs(inst, role, requestTextbookFile, { textbookId: ncertBook, fileName: "x.pdf", sizeBytes: 10 })).ok).toBe(false);
    }
    // The subject's own teacher still may (remove, then re-upload).
    expect((await callAs(inst, "teacher", removeTextbookFile, { textbookId: customBook })).ok).toBe(true);
    expect((await uploadFile("teacher", customBook)).done?.ok).toBe(true);
  });

  it("refuses a non-PDF type, content that is not a PDF, and over 50 MB", async () => {
    const png = await inst.clientAs("admin").from("documents").insert({
      institution_id: inst.institutionId, entity_type: "subject_textbook", entity_id: ncertBook, kind: "textbook", file_name: "x.png",
      mime: "image/png", size_bytes: 10, path: `${inst.institutionId}/subject_textbook/${ncertBook}/${crypto.randomUUID()}.png`, created_by: inst.users.admin.id,
    });
    expect(png.error).not.toBeNull();
    const fake = await uploadFile("teacher", ncertBook, new TextEncoder().encode("MZ not a pdf at all"));
    expect(fake.done?.ok).toBe(false);
    const big = await callAs(inst, "teacher", requestTextbookFile, { textbookId: ncertBook, fileName: "big.pdf", sizeBytes: 50 * MB + 1 });
    expect(big.ok).toBe(false);
    // The earlier good file is still the live one.
    expect(await docRows(ncertBook, "active")).toHaveLength(1);
  });

  it("allows a PDF over 10 MB for a textbook but the 10 MB cap holds for other kinds (row check and stored size)", async () => {
    const asRow = (entity_type: string, entity_id: string, size_bytes: number) =>
      inst.clientAs("admin").from("documents").insert({
        institution_id: inst.institutionId, entity_type, entity_id, kind: "x", file_name: "x.pdf", mime: "application/pdf", size_bytes,
        path: `${inst.institutionId}/${entity_type}/${entity_id}/${crypto.randomUUID()}.pdf`, created_by: inst.users.admin.id,
      });
    expect((await asRow("subject_textbook", ncertBook, 20 * MB)).error).toBeNull();
    expect((await asRow("subject_textbook", ncertBook, 50 * MB + 1)).error).not.toBeNull();
    expect((await asRow("student", crypto.randomUUID(), 11 * MB)).error).not.toBeNull();

    // A real 12 MB textbook PDF goes through the whole flow.
    const { done } = await uploadFile("teacher", customBook, pdfBytes(12 * MB));
    expect(done?.ok, JSON.stringify(done)).toBe(true);

    // The bucket now accepts 50 MB, so activation is where another kind's 10 MB cap is enforced on the real object.
    const path = `${inst.institutionId}/curriculum_material/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;
    const docId = crypto.randomUUID();
    const matId = path.split("/")[2]!;
    const teacher = inst.clientAs("teacher");
    expect((await teacher.from("curriculum_materials").insert({ id: matId, institution_id: inst.institutionId, title: "Big", owner_kind: "staff", visibility: "class", grade_id: gradeVI, subject_id: maths, created_by: inst.users.teacher.id })).error).toBeNull();
    expect((await teacher.from("documents").insert({ id: docId, institution_id: inst.institutionId, entity_type: "curriculum_material", entity_id: matId, kind: "curriculum", file_name: "big.pdf", mime: "application/pdf", size_bytes: 100, path, created_by: inst.users.teacher.id })).error).toBeNull();
    expect((await teacher.storage.from(BUCKET).upload(path, pdfBytes(11 * MB), { contentType: "application/pdf" })).error).toBeNull();
    const act = await teacher.from("documents").update({ status: "active" }).eq("id", docId).select("id");
    expect(act.error !== null || (act.data ?? []).length === 0).toBe(true);
    expect((await one(sql`select status from public.documents where id = ${docId}`)).status).toBe("pending");
  }, 120_000);

  it("a kind with no SQL exists-check cannot go live before its object exists, nor with an 11 MB object", async () => {
    const studentId = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
    const req = await callAs(inst, "admin", requestUpload, { entityType: "student", entityId: studentId, kind: "id_proof", fileName: "id.pdf", mime: "application/pdf", sizeBytes: 1000 });
    if (!req.ok) throw new Error(JSON.stringify(req.error));
    const activate = () => inst.clientAs("admin").from("documents").update({ status: "active" }).eq("id", req.data.documentId).select("id");
    const status = async () => (await one(sql`select status from public.documents where id = ${req.data.documentId}`)).status;

    const early = await activate();
    expect(early.error !== null || (early.data ?? []).length === 0).toBe(true);
    expect(await status()).toBe("pending");

    // The signed URL minted while pending still works; the bucket takes 50 MB, the kind's cap is 10 MB.
    expect((await inst.clientAs("admin").storage.from(BUCKET).uploadToSignedUrl(req.data.path, req.data.token, pdfBytes(11 * MB), { contentType: "application/pdf" })).error).toBeNull();
    const late = await activate();
    expect(late.error !== null || (late.data ?? []).length === 0).toBe(true);
    expect(await status()).toBe("pending");
  }, 120_000);

  it("a replacement retires the previous copy; the reader gets the new one", async () => {
    const before = (await docRows(ncertBook, "active"))[0]!;
    const { done } = await uploadFile("teacher", ncertBook, pdfBytes(300));
    expect(done?.ok).toBe(true);
    const live = await docRows(ncertBook, "active");
    expect(live).toHaveLength(1);
    expect(live[0]!.id).not.toBe(before.id);
    expect((await sql`select status from public.documents where id = ${before.id}`)[0]!.status).toBe("deleted");
    expect(await canFetch(inst.clientAs("student"), live[0]!.path as string)).toBe(true);
  });

  it("removing the file retires it; removing the textbook retires its file for everyone", async () => {
    const rm = await callAs(inst, "teacher", removeTextbookFile, { textbookId: customBook });
    expect(rm.ok).toBe(true);
    expect(await docRows(customBook, "active")).toHaveLength(0);
    expect((await callAs(inst, "student", getTextbookFileUrl, { textbookId: customBook })).ok).toBe(false);

    const path = (await docRows(ncertBook, "active"))[0]!.path as string;
    expect((await callAs(inst, "teacher", removeTextbook, { textbookId: ncertBook })).ok).toBe(true);
    expect(await docRows(ncertBook, "active")).toHaveLength(0);
    expect((await docRows(ncertBook, "deleted")).length).toBeGreaterThan(0);
    for (const client of [inst.clientAs("student"), inst.clientAs("admin"), inst.clientAs("teacher")]) expect(await canFetch(client, path)).toBe(false);
  });
});
