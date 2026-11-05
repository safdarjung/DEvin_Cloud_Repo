// X02-T3: migration 0091 part 2 — app.issue_certificate / public.issue_certificate.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
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
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(
  institutionId: string,
  admissionNo: string,
  overrides: Partial<{ firstName: string; lastName: string; dob: string; gender: string; status: string }> = {},
) {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender, status)
    values (
      ${institutionId}, ${admissionNo}, ${overrides.firstName ?? "Priya"}, ${overrides.lastName ?? "Sharma"},
      ${overrides.dob ?? "2016-05-10"}, ${overrides.gender ?? "female"}, ${overrides.status ?? "active"}
    )
    returning id
  `;
  return row.id as string;
}

async function guardianMembership(institutionId: string) {
  const [row] = await sql`
    select user_id, guardian_id from public.memberships
    where institution_id = ${institutionId} and role = 'guardian'
  `;
  return { userId: row.user_id as string, guardianId: row.guardian_id as string };
}

async function linkGuardian(institutionId: string, guardianId: string, studentId: string) {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', true)
  `;
}

async function enrolledStudentFixture(institutionId: string, admissionNo: string) {
  const yearId = await createAcademicYear(institutionId);
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId, { name: "A" });
  const studentId = await insertStudent(institutionId, admissionNo);
  await createEnrolment(institutionId, studentId, sectionId, yearId, { rollNo: 7 });
  const { guardianId } = await guardianMembership(institutionId);
  await linkGuardian(institutionId, guardianId, studentId);
  return { studentId, yearId, gradeId, sectionId };
}

describe("migration 0091 part 2: issue_certificate", () => {
  it("admissions issues a bonafide for an active student with gap-free serials, merged numbering and a row-sourced snapshot", async () => {
    const inst = await createTestInstitution("cert-bonafide");
    try {
      const { studentId } = await enrolledStudentFixture(inst.institutionId, "ADM-RPC1");
      const year = new Date().getFullYear();

      const first = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "bonafide",
        p_purpose: "For passport application",
      });
      expect(first.error).toBeNull();
      expect(first.data.serial_no).toBe(`BON/${year}/00001`);
      expect(first.data.created).toBe(true);

      const second = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "bonafide",
        p_purpose: "For bank account opening",
      });
      expect(second.error).toBeNull();
      expect(second.data.serial_no).toBe(`BON/${year}/00002`);

      const [institution] = await sql`select settings from public.institutions where id = ${inst.institutionId}`;
      expect(institution.settings.numbering.bonafide_no).toBe("BON/{YYYY}/{SEQ:5}");

      const [row] = await sql`select * from public.certificates where id = ${first.data.certificate_id}`;
      expect(row.snapshot.student.name).toBe("Priya Sharma");
      expect(row.snapshot.student.admission_no).toBe("ADM-RPC1");
      expect(row.snapshot.enrolment.grade).toBeDefined();
      expect(row.snapshot.enrolment.section).toBe("A");
      expect(row.snapshot.enrolment.academic_year).toBeDefined();
      expect(row.snapshot.guardian.name).toContain("Test Guardian");
      expect(row.snapshot.purpose).toBe("For passport application");

      const [audit] = await sql`
        select metadata from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'certificate.issued' and entity_id = ${first.data.certificate_id}
      `;
      expect(Object.keys(audit.metadata).sort()).toEqual(["certificate_id", "kind", "serial_no"]);
    } finally {
      await inst.cleanup();
    }
  });

  it("character certificate with conduct 'Good' gets CHR/<YYYY>/00001", async () => {
    const inst = await createTestInstitution("cert-character");
    try {
      const { studentId } = await enrolledStudentFixture(inst.institutionId, "ADM-RPC2");
      const year = new Date().getFullYear();

      const { data, error } = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "character",
        p_conduct: "Good",
      });
      expect(error).toBeNull();
      expect(data.serial_no).toBe(`CHR/${year}/00001`);
    } finally {
      await inst.cleanup();
    }
  });

  it("bonafide without purpose is validation_failed; bonafide for a withdrawn student is invalid_state", async () => {
    const inst = await createTestInstitution("cert-bonafide-guards");
    try {
      const { studentId } = await enrolledStudentFixture(inst.institutionId, "ADM-RPC3");

      const noPurpose = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "bonafide",
      });
      expect(noPurpose.error?.message).toContain("code:validation_failed");

      await sql`update public.students set status = 'withdrawn' where id = ${studentId}`;
      const withdrawn = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "bonafide",
        p_purpose: "For passport application",
      });
      expect(withdrawn.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("transfer after exit_student: serial = tc_no, snapshot.tc = the event snapshot; a repeat call is idempotent", async () => {
    const inst = await createTestInstitution("cert-transfer");
    try {
      const { studentId } = await enrolledStudentFixture(inst.institutionId, "ADM-RPC4");

      const exit = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });
      expect(exit.error).toBeNull();

      const first = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "transfer",
      });
      expect(first.error).toBeNull();
      expect(first.data.serial_no).toBe(exit.data.tc_no);
      expect(first.data.created).toBe(true);

      const [row] = await sql`select * from public.certificates where id = ${first.data.certificate_id}`;
      expect(row.lifecycle_event_id).not.toBeNull();
      expect(row.snapshot.tc.tc_no).toBe(exit.data.tc_no);

      const second = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "transfer",
      });
      expect(second.error).toBeNull();
      expect(second.data.certificate_id).toBe(first.data.certificate_id);
      expect(second.data.created).toBe(false);

      const rows = await sql`select id from public.certificates where student_id = ${studentId}`;
      expect(rows).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("transfer for an active student is invalid_state; transfer with a purpose is validation_failed", async () => {
    const inst = await createTestInstitution("cert-transfer-guards");
    try {
      const { studentId } = await enrolledStudentFixture(inst.institutionId, "ADM-RPC5");

      const active = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "transfer",
      });
      expect(active.error?.message).toContain("code:invalid_state");

      await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });

      const withPurpose = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: studentId,
        p_kind: "transfer",
        p_purpose: "Not allowed",
      });
      expect(withPurpose.error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher and accountant are forbidden; an unknown student is not_found", async () => {
    const inst = await createTestInstitution("cert-roles");
    try {
      const { studentId } = await enrolledStudentFixture(inst.institutionId, "ADM-RPC6");

      for (const role of ["teacher", "accountant"] as const) {
        const { error } = await inst.clientAs(role).rpc("issue_certificate", {
          p_student_id: studentId,
          p_kind: "bonafide",
          p_purpose: "For passport application",
        });
        expect(error?.message, role).toContain("code:forbidden");
      }

      const { error } = await inst.clientAs("admissions").rpc("issue_certificate", {
        p_student_id: crypto.randomUUID(),
        p_kind: "bonafide",
        p_purpose: "For passport application",
      });
      expect(error?.message).toContain("code:not_found");
    } finally {
      await inst.cleanup();
    }
  });
});
