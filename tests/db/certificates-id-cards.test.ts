// X02-T9 — src/modules/certificates/id-cards.queries.ts via the
// query-defs wrapper (callAs — real permission guard + real RLS), same
// pattern as tests/db/certificates-queries.test.ts. Photo bytes go through
// a real signed upload (tests/db/documents-read-actions.test.ts pattern),
// never a service-role write.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { certificatesIdCardsHtmlQuery } from "@/modules/certificates/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(institutionId: string, admissionNo: string, firstName: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender, status)
    values (${institutionId}, ${admissionNo}, ${firstName}, 'Sharma', '2016-05-10', 'female', 'active')
    returning id
  `;
  return row.id as string;
}

async function withdrawStudent(studentId: string): Promise<void> {
  await sql`update public.students set status = 'withdrawn' where id = ${studentId}`;
  await sql`update public.enrolments set status = 'withdrawn' where student_id = ${studentId}`;
}

async function linkGuardian(institutionId: string, studentId: string, phone: string): Promise<void> {
  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${institutionId}, 'Rina Sharma', ${phone})
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardian.id}, ${studentId}, 'mother', true)
  `;
}

/** Inserts a pending photo document, uploads real bytes via a signed URL
 * (the creator's own client), then flips it active with a direct SQL
 * update — mirrors insertActiveDocumentWithBytes in documents-read-actions.test.ts. */
async function uploadPhoto(opts: {
  institutionId: string;
  studentId: string;
  createdBy: string;
  uploaderClient: ReturnType<TestInstitution["clientAs"]>;
  bytes: Buffer;
}): Promise<void> {
  const id = crypto.randomUUID();
  const path = `${opts.institutionId}/student/${opts.studentId}/${id}.png`;
  await sql`
    insert into public.documents (id, institution_id, entity_type, entity_id, kind, file_name, mime, size_bytes, path, created_by, status)
    values (${id}, ${opts.institutionId}, 'student', ${opts.studentId}, 'photo', 'photo.png', 'image/png', ${opts.bytes.length}, ${path}, ${opts.createdBy}, 'pending')
  `;
  const signed = await opts.uploaderClient.storage.from("tenant-docs").createSignedUploadUrl(path);
  if (signed.error || !signed.data) throw signed.error ?? new Error("no signed upload url");
  const uploaded = await opts.uploaderClient.storage
    .from("tenant-docs")
    .uploadToSignedUrl(path, signed.data.token, opts.bytes, { contentType: "image/png" });
  if (uploaded.error) throw uploaded.error;
  await sql`update public.documents set status = 'active' where id = ${id}`;
}

async function sectionFixture(institutionId: string) {
  const yearId = await createAcademicYear(institutionId);
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId, { name: "A" });
  return { yearId, gradeId, sectionId };
}

describe("certificates.idCardsHtml (X02-T9)", () => {
  it("3 active students -> 3 cards with admission nos and guardian phones; a withdrawn student's card is absent", async () => {
    const inst = await createTestInstitution("cert-idc-basic");
    try {
      const { sectionId, yearId } = await sectionFixture(inst.institutionId);
      const s1 = await insertStudent(inst.institutionId, "ADM-IC1", "Asha");
      const s2 = await insertStudent(inst.institutionId, "ADM-IC2", "Bina");
      const s3 = await insertStudent(inst.institutionId, "ADM-IC3", "Chitra");
      const withdrawn = await insertStudent(inst.institutionId, "ADM-IC4", "Diya");
      await createEnrolment(inst.institutionId, s1, sectionId, yearId, { rollNo: 1 });
      await createEnrolment(inst.institutionId, s2, sectionId, yearId, { rollNo: 2 });
      await createEnrolment(inst.institutionId, s3, sectionId, yearId, { rollNo: 3 });
      await createEnrolment(inst.institutionId, withdrawn, sectionId, yearId, { rollNo: 4 });
      await withdrawStudent(withdrawn);
      await linkGuardian(inst.institutionId, s1, "9876543210");

      const result = await callAs(inst, "admin", certificatesIdCardsHtmlQuery, { classSectionId: sectionId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).not.toBeNull();
      const html = result.data?.html ?? "";
      expect(html).toContain("ADM-IC1");
      expect(html).toContain("ADM-IC2");
      expect(html).toContain("ADM-IC3");
      expect(html).not.toContain("ADM-IC4");
      expect(html).toContain("+91 98765 43210");
    } finally {
      await inst.cleanup();
    }
  });

  it("a 1 KB PNG photo shows as data:image/png;base64, on that card and placeholders on others", async () => {
    const inst = await createTestInstitution("cert-idc-photo");
    try {
      const { sectionId, yearId } = await sectionFixture(inst.institutionId);
      const withPhoto = await insertStudent(inst.institutionId, "ADM-IP1", "Esha");
      const withoutPhoto = await insertStudent(inst.institutionId, "ADM-IP2", "Farah");
      await createEnrolment(inst.institutionId, withPhoto, sectionId, yearId, { rollNo: 1 });
      await createEnrolment(inst.institutionId, withoutPhoto, sectionId, yearId, { rollNo: 2 });
      await uploadPhoto({
        institutionId: inst.institutionId,
        studentId: withPhoto,
        createdBy: inst.users.admin.id,
        uploaderClient: inst.clientAs("admin"),
        bytes: Buffer.alloc(1024, 1),
      });

      const result = await callAs(inst, "admin", certificatesIdCardsHtmlQuery, { classSectionId: sectionId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const html = result.data?.html ?? "";
      expect(html).toContain("data:image/png;base64,");
      expect(html).toContain("card-initials"); // placeholder for the student with no photo
    } finally {
      await inst.cleanup();
    }
  });

  it("a 60 KB photo falls back to the placeholder and the footer names it skipped", async () => {
    const inst = await createTestInstitution("cert-idc-oversize");
    try {
      const { sectionId, yearId } = await sectionFixture(inst.institutionId);
      const studentId = await insertStudent(inst.institutionId, "ADM-IO1", "Gita");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });
      await uploadPhoto({
        institutionId: inst.institutionId,
        studentId,
        createdBy: inst.users.admin.id,
        uploaderClient: inst.clientAs("admin"),
        bytes: Buffer.alloc(61440, 1),
      });

      const result = await callAs(inst, "admin", certificatesIdCardsHtmlQuery, { classSectionId: sectionId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const html = result.data?.html ?? "";
      expect(html).not.toContain("data:image/png;base64,");
      expect(html).toContain("photos over 50 KB not shown");
    } finally {
      await inst.cleanup();
    }
  });

  it("65 students with null roll_no truncates to the first 60 by first_name, deterministically", async () => {
    const inst = await createTestInstitution("cert-idc-truncation");
    try {
      const { sectionId, yearId } = await sectionFixture(inst.institutionId);
      // Names chosen so alphabetical order differs from insertion order.
      const names = Array.from({ length: 65 }, (_, i) => `Student${String(64 - i).padStart(2, "0")}`);
      for (const name of names) {
        const studentId = await insertStudent(inst.institutionId, `ADM-TR-${name}`, name);
        await createEnrolment(inst.institutionId, studentId, sectionId, yearId);
      }

      const run = () => callAs(inst, "admin", certificatesIdCardsHtmlQuery, { classSectionId: sectionId });
      const [first, second] = await Promise.all([run(), run()]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      const htmlA = first.data?.html ?? "";
      const htmlB = second.data?.html ?? "";
      expect(htmlA).toBe(htmlB); // same request twice -> identical card set (not arbitrary per-request)
      // First 60 alphabetically (Student00..Student59) are kept, the alphabetically-last 5 are cut.
      for (let i = 0; i < 60; i++) {
        expect(htmlA).toContain(`ADM-TR-Student${String(i).padStart(2, "0")}`);
      }
      for (let i = 60; i < 65; i++) {
        expect(htmlA).not.toContain(`ADM-TR-Student${String(i).padStart(2, "0")}`);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("another institution's section returns null", async () => {
    const instA = await createTestInstitution("cert-idc-xtenant-a");
    const instB = await createTestInstitution("cert-idc-xtenant-b");
    try {
      const { sectionId } = await sectionFixture(instA.institutionId);

      const result = await callAs(instB, "admin", certificatesIdCardsHtmlQuery, { classSectionId: sectionId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("teacher has no certificate.manage permission -> forbidden", async () => {
    const inst = await createTestInstitution("cert-idc-forbidden");
    try {
      const { sectionId } = await sectionFixture(inst.institutionId);

      const result = await callAs(inst, "teacher", certificatesIdCardsHtmlQuery, { classSectionId: sectionId });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
