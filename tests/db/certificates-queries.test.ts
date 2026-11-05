// X02-T8 — src/modules/certificates/queries.ts via the query-defs wrapper
// (callAs — real permission guard + real RLS), same pattern as
// tests/db/facilities-queries.test.ts. Rows are created by calling
// app.issue_certificate directly over `sql` (bypasses the actor-role check
// in the public wrapper; this is a fixture helper, not the RPC under test —
// that's tests/db/certificates-issue-rpc.test.ts).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { certificatesListQuery, certificatesPrintHtmlQuery } from "@/modules/certificates/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender, status)
    values (${institutionId}, ${admissionNo}, 'Priya', 'Sharma', '2016-05-10', 'female', 'active')
    returning id
  `;
  return row.id as string;
}

async function enrolledStudentFixture(institutionId: string, admissionNo: string) {
  const yearId = await createAcademicYear(institutionId);
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId, { name: "A" });
  const studentId = await insertStudent(institutionId, admissionNo);
  await createEnrolment(institutionId, studentId, sectionId, yearId, { rollNo: 7 });
  return studentId;
}

// Fixture users have no auth user_metadata, so profiles.full_name is null
// by default (0002's handle_new_auth_user trigger) — printHtml's snapshot
// schema requires issued_by_name as a non-null string (rulings: Snapshot),
// same as every real staff member who has filled in their name.
async function nameActor(userId: string, fullName: string): Promise<void> {
  await sql`update public.profiles set full_name = ${fullName} where id = ${userId}`;
}

async function issueCertificate(
  actorId: string,
  studentId: string,
  kind: "bonafide" | "character" | "transfer",
  purpose: string | null = null,
  conduct: string | null = null,
): Promise<{ certificateId: string; serialNo: string }> {
  const [row] = await sql`
    select app.issue_certificate(${actorId}::uuid, ${studentId}::uuid, ${kind}, ${purpose}, ${conduct}) as result
  `;
  const result = row.result as { certificate_id: string; serial_no: string; created: boolean };
  return { certificateId: result.certificate_id, serialNo: result.serial_no };
}

describe("certificates.list + certificates.printHtml queries (X02-T8)", () => {
  it("lists by studentId newest first", async () => {
    const inst = await createTestInstitution("cert-q-list");
    try {
      const studentId = await enrolledStudentFixture(inst.institutionId, "ADM-CQ1");
      const actorId = inst.users.admin.id;
      await issueCertificate(actorId, studentId, "bonafide", "Passport application");
      const second = await issueCertificate(actorId, studentId, "character", null, "Good");

      const result = await callAs(inst, "admissions", certificatesListQuery, { studentId, limit: 50 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(2);
      expect(result.data[0].serialNo).toBe(second.serialNo);
      expect(result.data[0].kind).toBe("character");
      expect(result.data[0].studentName).toBe("Priya Sharma");
      expect(result.data[0].classLabel.length).toBeGreaterThan(0);
      expect(result.data[1].kind).toBe("bonafide");
      expect(result.data[1].purpose).toBe("Passport application");
    } finally {
      await inst.cleanup();
    }
  });

  it("serialNo exact match returns one row, an unknown serial returns none", async () => {
    const inst = await createTestInstitution("cert-q-serial");
    try {
      const studentId = await enrolledStudentFixture(inst.institutionId, "ADM-CQ2");
      const issued = await issueCertificate(inst.users.admin.id, studentId, "bonafide", "For records");

      const found = await callAs(inst, "admissions", certificatesListQuery, { serialNo: issued.serialNo, limit: 50 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.data).toHaveLength(1);
      expect(found.data[0].id).toBe(issued.certificateId);

      const missing = await callAs(inst, "admissions", certificatesListQuery, { serialNo: "NOPE/0000/00000", limit: 50 });
      expect(missing.ok).toBe(true);
      if (!missing.ok) return;
      expect(missing.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("filters by kind", async () => {
    const inst = await createTestInstitution("cert-q-kind");
    try {
      const studentId = await enrolledStudentFixture(inst.institutionId, "ADM-CQ3");
      const actorId = inst.users.admin.id;
      await issueCertificate(actorId, studentId, "bonafide", "For one");
      await issueCertificate(actorId, studentId, "character", null, "Good");

      const result = await callAs(inst, "admissions", certificatesListQuery, { kind: "character", limit: 50 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].kind).toBe("character");
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant has no certificate.manage permission -> forbidden", async () => {
    const inst = await createTestInstitution("cert-q-forbidden");
    try {
      const result = await callAs(inst, "accountant", certificatesListQuery, { limit: 50 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("printHtml renders the frozen snapshot with the student name and serial", async () => {
    const inst = await createTestInstitution("cert-q-print");
    try {
      const studentId = await enrolledStudentFixture(inst.institutionId, "ADM-CQ4");
      await nameActor(inst.users.admin.id, "Test Admin");
      const issued = await issueCertificate(inst.users.admin.id, studentId, "bonafide", "For scholarship");

      const result = await callAs(inst, "admissions", certificatesPrintHtmlQuery, { certificateId: issued.certificateId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).not.toBeNull();
      expect(result.data?.html).toContain("Priya Sharma");
      expect(result.data?.html).toContain(issued.serialNo);
    } finally {
      await inst.cleanup();
    }
  });

  it("another institution's certificate id returns null", async () => {
    const instA = await createTestInstitution("cert-q-xtenant-a");
    const instB = await createTestInstitution("cert-q-xtenant-b");
    try {
      const studentId = await enrolledStudentFixture(instA.institutionId, "ADM-CQ5");
      const issued = await issueCertificate(instA.users.admin.id, studentId, "bonafide", "For records");

      const result = await callAs(instB, "admissions", certificatesPrintHtmlQuery, { certificateId: issued.certificateId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });
});
