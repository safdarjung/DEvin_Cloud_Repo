import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createApplication,
  createClassSection,
  createEnrolment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function setFinanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'finance', jsonb_build_object('financial_year_start_month', 4, 'default_due_day', 10),
      'numbering', jsonb_build_object(
        'admission_no', 'ADM/{YYYY}/{SEQ:5}', 'invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}',
        'application_no', 'APP/{YYYY}/{SEQ:5}'
      )
    )
    where id = ${institutionId}
  `;
}

interface EnrolResult {
  student_id: string;
  admission_no: string;
  guardian_id: string;
  enrolment_id: string;
  invoice_id: string;
  already_enrolled: boolean;
}

// Spans the whole academic year (createAcademicYear's default
// 2026-04-01..2027-03-31, which includes "today" at the time this packet
// was built) so app.enrol_applicant's "current term" lookup — term
// containing today's institution-local date — always matches this term.
// app.validate_term_dates (0002) requires term dates to fall within the
// academic year's own dates, so this must match createAcademicYear's
// default range exactly, not an arbitrary wide range.
async function setUpTerm1(institutionId: string, academicYearId: string): Promise<string> {
  return createTerm(institutionId, academicYearId, {
    name: "Term 1",
    sequence: 1,
    startsOn: "2026-04-01",
    endsOn: "2027-03-31",
  });
}

describe("enrolment (T-030 app.enrol_applicant) — 06 §W4 (C-20..C-23)", () => {
  it("Fix round 1 (HIGH, DBT-20): a direct status update to 'enrolled' is blocked; enrol_applicant still works", async () => {
    const inst = await createTestInstitution("enrol-fix2");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      await setUpTerm1(inst.institutionId, yearId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { capacity: 45 });
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status: "accepted" });

      // Direct bypass attempt — same role/client enrol_applicant uses, but a raw table UPDATE.
      const direct = await inst
        .clientAs("admissions")
        .from("applications")
        .update({ status: "enrolled" })
        .eq("id", applicationId)
        .select("id");
      expect(direct.error).not.toBeNull();

      const [stillAccepted] = await sql`select status from public.applications where id = ${applicationId}`;
      expect(stillAccepted.status).toBe("accepted");
      const [studentCountBefore] = await sql`
        select count(*)::int as count from public.students where source_application_id = ${applicationId}
      `;
      expect(studentCountBefore.count).toBe(0);

      const result = await inst.clientAs("admissions").rpc("enrol_applicant", {
        p_application_id: applicationId,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      expect(result.error).toBeNull();

      const [nowEnrolled] = await sql`select status from public.applications where id = ${applicationId}`;
      expect(nowEnrolled.status).toBe("enrolled");
    } finally {
      await inst.cleanup();
    }
  });

  it("C-20: enrol_applicant is idempotent — retrying returns the same student", async () => {
    const inst = await createTestInstitution("enrol-c20");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      await setUpTerm1(inst.institutionId, yearId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { capacity: 45 });
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);

      const first = await inst.clientAs("admissions").rpc("enrol_applicant", {
        p_application_id: applicationId,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      expect(first.error).toBeNull();
      const firstData = first.data as EnrolResult;
      expect(firstData.already_enrolled).toBe(false);
      expect(firstData.invoice_id).toBeTruthy();

      const second = await inst.clientAs("admissions").rpc("enrol_applicant", {
        p_application_id: applicationId,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      expect(second.error).toBeNull();
      const secondData = second.data as EnrolResult;
      expect(secondData.student_id).toBe(firstData.student_id);
      expect(secondData.admission_no).toBe(firstData.admission_no);
      expect(secondData.already_enrolled).toBe(true);

      const [studentCount] = await sql`
        select count(*)::int as count from public.students where source_application_id = ${applicationId}
      `;
      expect(studentCount.count).toBe(1);

      const [application] = await sql`select status from public.applications where id = ${applicationId}`;
      expect(application.status).toBe("enrolled");
    } finally {
      await inst.cleanup();
    }
  });

  it("C-21: a guardian matched by phone is reused across two applications, not duplicated", async () => {
    const inst = await createTestInstitution("enrol-c21");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      await setUpTerm1(inst.institutionId, yearId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { capacity: 45 });
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });

      const phone = "9800000002";
      const app1 = await createApplication(inst.institutionId, gradeId, yearId, {
        guardian: { fullName: "Rohit Mehta", phone, relationship: "father" },
      });
      const app2 = await createApplication(inst.institutionId, gradeId, yearId, {
        applicant: { firstName: "Second", lastName: "Child", dob: "2018-01-01", gender: "male" },
        guardian: { fullName: "Rohit Mehta", phone, relationship: "father" },
      });

      const result1 = await inst.clientAs("admissions").rpc("enrol_applicant", {
        p_application_id: app1,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      const result2 = await inst.clientAs("admissions").rpc("enrol_applicant", {
        p_application_id: app2,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      expect(result1.error).toBeNull();
      expect(result2.error).toBeNull();

      const data1 = result1.data as EnrolResult;
      const data2 = result2.data as EnrolResult;
      expect(data1.guardian_id).toBe(data2.guardian_id);
      expect(data1.student_id).not.toBe(data2.student_id);

      const [guardianCount] = await sql`
        select count(*)::int as count from public.guardians where institution_id = ${inst.institutionId} and phone = ${phone}
      `;
      expect(guardianCount.count).toBe(1);

      const [linkCount] = await sql`
        select count(*)::int as count from public.guardian_students where guardian_id = ${data1.guardian_id}
      `;
      expect(linkCount.count).toBe(2);

      // Exactly one primary guardian per student — each link row is its own student's only primary.
      const [primaryCount] = await sql`
        select count(*)::int as count from public.guardian_students
        where guardian_id = ${data1.guardian_id} and is_primary = true
      `;
      expect(primaryCount.count).toBe(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-22: enrolling into a full section returns conflict", async () => {
    const inst = await createTestInstitution("enrol-c22");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      await setUpTerm1(inst.institutionId, yearId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { capacity: 1 });
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });

      const [fillerStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-C22-FILLER', 'Filler', '2015-01-01', 'other')
        returning id
      `;
      await createEnrolment(inst.institutionId, fillerStudent.id as string, sectionId, yearId, { rollNo: 1 });

      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);
      const result = await inst.clientAs("admissions").rpc("enrol_applicant", {
        p_application_id: applicationId,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      expect(result.error?.message).toBe("code:conflict");

      const [studentCount] = await sql`
        select count(*)::int as count from public.students where source_application_id = ${applicationId}
      `;
      expect(studentCount.count).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-23: enrolling an application that is not accepted returns invalid_state", async () => {
    const inst = await createTestInstitution("enrol-c23");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      await setUpTerm1(inst.institutionId, yearId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { capacity: 45 });
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status: "offered" });

      const result = await inst.clientAs("admissions").rpc("enrol_applicant", {
        p_application_id: applicationId,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      expect(result.error?.message).toBe("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher (no admissions.enrol role) is forbidden from calling enrol_applicant", async () => {
    const inst = await createTestInstitution("enrol-forbidden");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      await setUpTerm1(inst.institutionId, yearId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { capacity: 45 });
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);

      const result = await inst.clientAs("teacher").rpc("enrol_applicant", {
        p_application_id: applicationId,
        p_class_section_id: sectionId,
        p_fee_structure_id: structureId,
        p_roll_no: null,
      });
      expect(result.error?.message).toBe("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
