import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { issueCertificate } from "@/modules/certificates/actions";
import { withdraw } from "@/modules/lifecycle/actions";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X02-T7 — certificate.issue action wrapper over the 0091 public.issue_certificate
// definer. Same shape as tests/db/lifecycle-actions.test.ts: real per-role
// TenantContext via callAs, no mocked Supabase client.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

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

async function enrolledStudent(inst: TestInstitution, admissionNo: string): Promise<string> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const studentId = await insertStudent(inst.institutionId, admissionNo);
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 7 });
  return studentId;
}

async function studentMembership(institutionId: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships
    where institution_id = ${institutionId} and role = 'student'
  `;
  return row.student_id as string;
}

describe("certificate.issue action (X02-T7)", () => {
  it("admissions issues a bonafide certificate with a gap-free serial", async () => {
    const inst = await createTestInstitution("cert-actions-bonafide");
    try {
      const studentId = await enrolledStudent(inst, "ADM-ACT1");
      const year = new Date().getFullYear();

      const first = await callAs(inst, "admissions", issueCertificate, {
        kind: "bonafide",
        studentId,
        purpose: "Passport application",
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.serialNo).toBe(`BON/${year}/00001`);
      expect(first.data.created).toBe(true);

      const second = await callAs(inst, "admissions", issueCertificate, {
        kind: "bonafide",
        studentId,
        purpose: "Bank account opening",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.serialNo).toBe(`BON/${year}/00002`);
    } finally {
      await inst.cleanup();
    }
  });

  it("admissions issues a character certificate with its own serial series", async () => {
    const inst = await createTestInstitution("cert-actions-character");
    try {
      const studentId = await enrolledStudent(inst, "ADM-ACT2");
      const year = new Date().getFullYear();

      const result = await callAs(inst, "admissions", issueCertificate, {
        kind: "character",
        studentId,
        conduct: "Good",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.serialNo).toBe(`CHR/${year}/00001`);
      expect(result.data.created).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("transfer after lifecycle.withdraw reuses the TC's serial; a repeat returns created: false", async () => {
    const inst = await createTestInstitution("cert-actions-transfer");
    try {
      const studentId = await studentMembership(inst.institutionId);

      const withdrawn = await callAs(inst, "admin", withdraw, {
        studentId,
        reason: "Family relocating to another city",
      });
      expect(withdrawn.ok).toBe(true);
      if (!withdrawn.ok) return;

      const first = await callAs(inst, "admissions", issueCertificate, {
        kind: "transfer",
        studentId,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.serialNo).toBe(withdrawn.data.tcNo);
      expect(first.data.created).toBe(true);

      const second = await callAs(inst, "admissions", issueCertificate, {
        kind: "transfer",
        studentId,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.serialNo).toBe(withdrawn.data.tcNo);
      expect(second.data.created).toBe(false);
    } finally {
      await inst.cleanup();
    }
  });

  it("a bonafide request for a withdrawn student is invalid_state", async () => {
    const inst = await createTestInstitution("cert-actions-invalid-state");
    try {
      const studentId = await studentMembership(inst.institutionId);

      const withdrawn = await callAs(inst, "admin", withdraw, {
        studentId,
        reason: "Family relocating to another city",
      });
      expect(withdrawn.ok).toBe(true);

      const result = await callAs(inst, "admissions", issueCertificate, {
        kind: "bonafide",
        studentId,
        purpose: "Passport application",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from issuing certificates", async () => {
    const inst = await createTestInstitution("cert-actions-forbidden");
    try {
      const studentId = await enrolledStudent(inst, "ADM-ACT3");

      const result = await callAs(inst, "teacher", issueCertificate, {
        kind: "bonafide",
        studentId,
        purpose: "Passport application",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("certificates stored false is forbidden with MODULE_DISABLED_MESSAGE and writes no row", async () => {
    const inst = await createTestInstitution("cert-actions-module-off");
    try {
      const studentId = await enrolledStudent(inst, "ADM-ACT4");
      await sql`
        update public.institutions
        set settings = settings || jsonb_build_object('modules', jsonb_build_object('certificates', false))
        where id = ${inst.institutionId}
      `;

      const result = await callAs(inst, "admissions", issueCertificate, {
        kind: "bonafide",
        studentId,
        purpose: "Passport application",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
      expect(result.error.message).toBe(MODULE_DISABLED_MESSAGE);

      const rows = await sql`select id from public.certificates where student_id = ${studentId}`;
      expect(rows.length).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });
});
