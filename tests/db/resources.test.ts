// Features-18 #23 — resources RLS, https-only URLs, teacher ownership, audience, documents flow.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { attachResourceFile, createResource, deleteResource, publishResource } from "@/modules/resources/actions";
import { portalResources, resourceSummary } from "@/modules/resources/queries";
import { callAs, buildContext, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;
let subjectId: string;
let sectionA: string; // taught by the fixture teacher; the student and guardian's child are in it
let sectionB: string; // taught by nobody
let studentId: string;
let outsiderId: string; // enrolled in section B only
let otherSubjectId: string;

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

beforeAll(async () => {
  inst = await createTestInstitution("rsrc");
  other = await createTestInstitution("rsrc-x");
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff });
  sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  studentId = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { status: "active" });
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)`;
  outsiderId = (await one(sql`insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, 'RS-X1', 'Other', 'Section', '2014-01-01', 'male') returning id`)).id as string;
  await createEnrolment(inst.institutionId, outsiderId, sectionB, yearId, { status: "active" });
  otherSubjectId = await createSubject(other.institutionId, { name: "Mathematics" });
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const note = (extra: Record<string, unknown> = {}) => ({ title: "Revision notes", kind: "note" as const, description: "Chapter 4 summary.", subjectId, classSectionIds: [sectionA], ...extra });

async function make(role: "teacher" | "admin" | "principal", extra: Record<string, unknown> = {}): Promise<string> {
  const r = await callAs(inst, role, createResource, note(extra));
  if (!r.ok) throw new Error(`setup: ${r.error.code} ${r.error.message}`);
  return r.data.id;
}

describe("resources", () => {
  it("teacher creates for a taught section only; managers any; student/guardian/accountant cannot create", async () => {
    expect((await callAs(inst, "teacher", createResource, note())).ok).toBe(true);
    const untaught = await callAs(inst, "teacher", createResource, note({ classSectionIds: [sectionB] }));
    expect(untaught.ok).toBe(false);
    // The failed create must not leave an orphan resource behind.
    const orphans = await sql`select 1 from public.resources where institution_id = ${inst.institutionId} and created_by = ${inst.users.teacher.id} and id not in (select resource_id from public.resource_sections)`;
    expect(orphans).toHaveLength(0);
    expect((await callAs(inst, "admin", createResource, note({ classSectionIds: [sectionB] }))).ok).toBe(true);
    for (const role of ["student", "guardian", "accountant"] as const) {
      expect((await callAs(inst, role, createResource, note())).ok).toBe(false);
    }
  });

  it("http://, javascript: and data: URLs are refused by Zod and by the database", async () => {
    for (const url of ["http://example.com/a", "javascript:alert(1)", "data:text/html,x"]) {
      expect((await callAs(inst, "teacher", createResource, { ...note(), kind: "link", url, description: undefined })).ok).toBe(false);
    }
    const ok = await callAs(inst, "teacher", createResource, { ...note(), kind: "link", url: "HTTPS://example.com/ok", description: undefined });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await one(sql`select url from public.resources where id = ${ok.data.id}`)).url).toBe("https://example.com/ok");
    // Bypass the action: the table check refuses non-https even for a manager.
    const direct = await inst.clientAs("admin").from("resources").insert({
      institution_id: inst.institutionId, title: "Direct", kind: "link", url: "http://example.com", subject_id: subjectId, created_by: inst.users.admin.id,
    });
    expect(direct.error).not.toBeNull();
    const js = await inst.clientAs("admin").from("resources").insert({
      institution_id: inst.institutionId, title: "Direct", kind: "link", url: "javascript:alert(1)", subject_id: subjectId, created_by: inst.users.admin.id,
    });
    expect(js.error).not.toBeNull();
  });

  it("unpublished is hidden from students and guardians; published reaches own section only", async () => {
    const id = await make("teacher");
    for (const role of ["student", "guardian"] as const) {
      const { data } = await inst.clientAs(role).from("resources").select("id").eq("id", id);
      expect(data).toEqual([]);
    }
    expect((await callAs(inst, "teacher", publishResource, { resourceId: id, published: true })).ok).toBe(true);
    for (const role of ["student", "guardian"] as const) {
      const { data } = await inst.clientAs(role).from("resources").select("id").eq("id", id);
      expect(data).toHaveLength(1);
    }
    expect((await callAs(inst, "teacher", publishResource, { resourceId: id, published: false })).ok).toBe(true);
    const { data: hidden } = await inst.clientAs("student").from("resources").select("id").eq("id", id);
    expect(hidden).toEqual([]);
  });

  it("a student of another section cannot read a published resource", async () => {
    const id = await make("teacher");
    await callAs(inst, "teacher", publishResource, { resourceId: id, published: true });
    // Move the fixture student to section B only: the audience (section A) no longer includes them.
    const yearId = (await one(sql`select academic_year_id from public.class_sections where id = ${sectionA}`)).academic_year_id as string;
    await sql`update public.enrolments set status = 'transferred' where student_id = ${studentId} and class_section_id = ${sectionA}`;
    await sql`insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
      values (${inst.institutionId}, ${studentId}, ${sectionB}, ${yearId}, '2026-04-01', 'active')`;
    try {
      const { data } = await inst.clientAs("student").from("resources").select("id").eq("id", id);
      expect(data).toEqual([]);
      const { data: g } = await inst.clientAs("guardian").from("resources").select("id").eq("id", id);
      expect(g).toEqual([]);
    } finally {
      await sql`delete from public.enrolments where student_id = ${studentId} and class_section_id = ${sectionB}`;
      await sql`update public.enrolments set status = 'active' where student_id = ${studentId} and class_section_id = ${sectionA}`;
    }
  });

  it("guardian sees only their own child's sections; portal query returns published rows for that child", async () => {
    const inA = await make("admin", { title: "For section A" });
    const inB = await make("admin", { title: "For section B", classSectionIds: [sectionB] });
    for (const id of [inA, inB]) await callAs(inst, "admin", publishResource, { resourceId: id, published: true });
    const { data } = await inst.clientAs("guardian").from("resources").select("id").in("id", [inA, inB]);
    expect((data ?? []).map((r) => r.id)).toEqual([inA]);
    const ctx = await buildContext(inst, "guardian");
    setActingClient(inst.clientAs("guardian"));
    const rows = await portalResources(ctx, studentId);
    expect(rows.some((r) => r.id === inA)).toBe(true);
    expect(rows.some((r) => r.id === inB)).toBe(false);
    expect(rows.every((r) => r.published)).toBe(true);
    // Not the child's section: nothing for a student the guardian does not have.
    expect((await portalResources(ctx, outsiderId)).some((r) => r.id === inA)).toBe(false);
  });

  it("a teacher cannot edit, publish, delete another teacher's resource or attach an untaught section", async () => {
    const adminsId = await make("admin");
    const pub = await callAs(inst, "teacher", publishResource, { resourceId: adminsId, published: true });
    expect(pub.ok).toBe(false);
    expect((await callAs(inst, "teacher", deleteResource, { resourceId: adminsId })).ok).toBe(false);
    const direct = await inst.clientAs("teacher").from("resources").update({ title: "Hijacked" }).eq("id", adminsId).select();
    expect(direct.error !== null || direct.data!.length === 0).toBe(true);
    const mine = await make("teacher");
    const sec = await inst.clientAs("teacher").from("resource_sections").insert({ resource_id: mine, institution_id: inst.institutionId, class_section_id: sectionB });
    expect(sec.error).not.toBeNull();
    const onAdmins = await inst.clientAs("teacher").from("resource_sections").insert({ resource_id: adminsId, institution_id: inst.institutionId, class_section_id: sectionA });
    expect(onAdmins.error).not.toBeNull();
    // Owner and managers can still manage it.
    expect((await callAs(inst, "principal", publishResource, { resourceId: adminsId, published: true })).ok).toBe(true);
  });

  it("file flow: unpublished without a file, publish blocked until a documents upload is attached", async () => {
    const id = await make("teacher", { kind: "file", description: undefined });
    const early = await callAs(inst, "teacher", publishResource, { resourceId: id, published: true });
    expect(!early.ok && early.error.code).toBe("invalid_state");
    // Attaching an unrelated/non-active document is refused by the guard trigger.
    const bogus = await callAs(inst, "teacher", attachResourceFile, { resourceId: id, documentId: crypto.randomUUID() });
    expect(bogus.ok).toBe(false);
    // documents row of entity type `resource`, as the documents module writes it after confirmUpload.
    const docId = crypto.randomUUID();
    await sql`insert into public.documents (id, institution_id, entity_type, entity_id, kind, file_name, mime, size_bytes, path, created_by, status)
      values (${docId}, ${inst.institutionId}, 'resource', ${id}, 'resource file', 'notes.pdf', 'application/pdf', 1000,
        ${`${inst.institutionId}/resource/${id}/${docId}.pdf`}, ${inst.users.teacher.id}, 'active')`;
    const attached = await callAs(inst, "teacher", attachResourceFile, { resourceId: id, documentId: docId });
    expect(attached.ok, JSON.stringify(attached)).toBe(true);
    expect((await callAs(inst, "teacher", publishResource, { resourceId: id, published: true })).ok).toBe(true);
    // Readers see the attached document row; a student of the audience section can read its metadata.
    const { data } = await inst.clientAs("student").from("documents").select("id").eq("id", docId);
    expect(data).toHaveLength(1);
  });

  it("a teacher's direct status update cannot activate their resource document until its object is uploaded", async () => {
    const id = await make("teacher", { kind: "file", description: undefined });
    const teacher = inst.clientAs("teacher");
    const docId = crypto.randomUUID();
    const path = `${inst.institutionId}/resource/${id}/${docId}.pdf`;
    // Pending row as requestUpload writes it (documents_insert_resource).
    const inserted = await teacher.from("documents").insert({
      id: docId, institution_id: inst.institutionId, entity_type: "resource", entity_id: id, kind: "resource file",
      file_name: "notes.pdf", mime: "application/pdf", size_bytes: 9, path, created_by: inst.users.teacher.id,
    });
    expect(inserted.error).toBeNull();

    // No object yet: the PostgREST flip that skips confirmUpload is refused (0131 guard trigger).
    const direct = await teacher.from("documents").update({ status: "active" }).eq("id", docId).select("id");
    expect(direct.error?.message).toBe("code:invalid_state");
    expect((await one(sql`select status from public.documents where id = ${docId}`)).status).toBe("pending");

    // With the object uploaded, the same update (confirmUpload's own) succeeds.
    const upload = await teacher.storage.from("tenant-docs").upload(path, new Blob(["%PDF-1.4\n"], { type: "application/pdf" }), { contentType: "application/pdf" });
    expect(upload.error).toBeNull();
    try {
      const confirmed = await teacher.from("documents").update({ status: "active" }).eq("id", docId).select("id");
      expect(confirmed.error).toBeNull();
      expect(confirmed.data).toHaveLength(1);
    } finally {
      const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
      await admin.storage.from("tenant-docs").remove([path]);
    }
  });

  it("cross-tenant: create with a foreign subject, publish and delete are refused; rows invisible", async () => {
    const id = await make("admin");
    expect((await callAs(inst, "admin", createResource, note({ subjectId: otherSubjectId }))).ok).toBe(false);
    const p = await callAs(other, "admin", publishResource, { resourceId: id, published: true });
    expect(!p.ok && p.error.code).toBe("not_found");
    expect((await callAs(other, "admin", deleteResource, { resourceId: id })).ok).toBe(false);
    const { data } = await other.clientAs("admin").from("resources").select("id").eq("id", id);
    expect(data).toEqual([]);
  });

  it("summary counts published resources by subject without names", async () => {
    const ctx = await buildContext(inst, "admin");
    setActingClient(inst.clientAs("admin"));
    const s = await resourceSummary(ctx);
    expect(s.bySubject.find((b) => b.subject === "Mathematics")!.count).toBeGreaterThan(0);
    expect(Object.keys(s.bySubject[0]!).sort()).toEqual(["count", "subject"]);
  });
});
