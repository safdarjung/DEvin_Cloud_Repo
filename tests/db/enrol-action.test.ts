import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern, same shape as admissions-actions.test.ts)
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { enrolApplicant } from "@/modules/admissions/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
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
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Same numbering + term setup as tests/db/enrolment.test.ts (T-030's SQL-level
// suite) — admission_no/invoice_no/receipt_no patterns are required by
// app.next_sequence, and the term must span "today" so enrol_applicant's
// current-term lookup matches.
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

async function setUpTerm(institutionId: string, academicYearId: string): Promise<string> {
  return createTerm(institutionId, academicYearId, {
    name: "Term 1",
    sequence: 1,
    startsOn: "2026-04-01",
    endsOn: "2027-03-31",
  });
}

interface Fixture {
  inst: TestInstitution;
  gradeId: string;
  yearId: string;
  sectionId: string;
  structureId: string;
}

async function buildFixture(name: string, sectionCapacity: number | null = 45): Promise<Fixture> {
  const inst = await createTestInstitution(name);
  await setFinanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  await setUpTerm(inst.institutionId, yearId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { capacity: sectionCapacity });
  const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
  await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
  return { inst, gradeId, yearId, sectionId, structureId };
}

describe("enrolApplicant action (T-028, 06 §W4, 07 §2.2 admissions.enrol)", () => {
  it("enrols an accepted application: returns studentId/admissionNo/invoiceId, alreadyEnrolled false", async () => {
    const { inst, gradeId, yearId, sectionId, structureId } = await buildFixture("enrol-action-happy");
    try {
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);

      const result = await callAs(inst, "admissions", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.admissionNo).toMatch(/^ADM\/\d{4}\/\d{5}$/);
      expect(result.data.alreadyEnrolled).toBe(false);
      expect(result.data.invoiceId).toBeTruthy();

      const [enrolment] = await sql`
        select roll_no, status from public.enrolments where student_id = ${result.data.studentId}
      `;
      expect(enrolment.status).toBe("active");
      const [feeAssignment] = await sql`
        select id from public.fee_assignments where student_id = ${result.data.studentId}
      `;
      expect(feeAssignment).toBeTruthy();
    } finally {
      await inst.cleanup();
    }
  });

  it("C-20 at the action layer: a second call returns alreadyEnrolled true with the same ids (role with finance.read, so the invoiceId fallback fill also works)", async () => {
    const { inst, gradeId, yearId, sectionId, structureId } = await buildFixture("enrol-action-idempotent");
    try {
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);

      // "admin" (not "admissions"): admin holds both admissions.enrol and
      // finance.read, so this exercises the invoiceId best-effort fill too.
      // "admissions" itself lacks finance.read — see the next test.
      const first = await callAs(inst, "admin", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = await callAs(inst, "admin", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      expect(second.data.studentId).toBe(first.data.studentId);
      expect(second.data.admissionNo).toBe(first.data.admissionNo);
      expect(second.data.alreadyEnrolled).toBe(true);
      expect(second.data.invoiceId).toBe(first.data.invoiceId);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-20 for the admissions role: idempotent too, but invoiceId on the retry is null — invoices_select RLS excludes admissions (documented gap, not fixed here)", async () => {
    const { inst, gradeId, yearId, sectionId, structureId } = await buildFixture("enrol-action-idempotent-admissions");
    try {
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);

      const first = await callAs(inst, "admissions", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.invoiceId).toBeTruthy(); // from the RPC's own jsonb return, not a table read

      const second = await callAs(inst, "admissions", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.alreadyEnrolled).toBe(true);
      expect(second.data.invoiceId).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("C-22 mapped to conflict: a full section", async () => {
    const { inst, gradeId, yearId, sectionId, structureId } = await buildFixture("enrol-action-capacity", 1);
    try {
      const [filler] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-FILLER', 'Filler', '2015-01-01', 'other')
        returning id
      `;
      await createEnrolment(inst.institutionId, filler.id as string, sectionId, yearId, { rollNo: 1 });
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);

      const result = await callAs(inst, "admissions", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("C-23 mapped to invalid_state: application not accepted", async () => {
    const { inst, gradeId, yearId, sectionId, structureId } = await buildFixture("enrol-action-state-guard");
    try {
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status: "offered" });

      const result = await callAs(inst, "admissions", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("roll_no collision (known gap, T-030): the raw unique violation is mapped to conflict, not internal", async () => {
    const { inst, gradeId, yearId, sectionId, structureId } = await buildFixture("enrol-action-rollno-collision");
    try {
      const appA = await createApplication(inst.institutionId, gradeId, yearId);
      const appB = await createApplication(inst.institutionId, gradeId, yearId, {
        applicant: { firstName: "Second", lastName: "Child", dob: "2018-01-01", gender: "male" },
      });

      const first = await callAs(inst, "admissions", enrolApplicant, {
        applicationId: appA,
        classSectionId: sectionId,
        feeStructureId: structureId,
        rollNo: 1,
      });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "admissions", enrolApplicant, {
        applicationId: appB,
        classSectionId: sectionId,
        feeStructureId: structureId,
        rollNo: 1,
      });

      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.code).toBe("conflict");
        expect(second.error.message).not.toMatch(/internal|reference:/i);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("not_found: a class section from another institution is rejected before the RPC call", async () => {
    const fixtureA = await buildFixture("enrol-action-cross-a");
    const fixtureB = await buildFixture("enrol-action-cross-b");
    try {
      const applicationId = await createApplication(fixtureA.inst.institutionId, fixtureA.gradeId, fixtureA.yearId);

      const result = await callAs(fixtureA.inst, "admissions", enrolApplicant, {
        applicationId,
        classSectionId: fixtureB.sectionId,
        feeStructureId: fixtureA.structureId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");

      const [studentCount] = await sql`
        select count(*)::int as count from public.students where source_application_id = ${applicationId}
      `;
      expect(studentCount.count).toBe(0);
    } finally {
      await fixtureA.inst.cleanup();
      await fixtureB.inst.cleanup();
    }
  });

  it("forbidden: a teacher (no admissions.enrol permission) is rejected by the permission check, not the RPC", async () => {
    const { inst, gradeId, yearId, sectionId, structureId } = await buildFixture("enrol-action-forbidden");
    try {
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId);

      const result = await callAs(inst, "teacher", enrolApplicant, {
        applicationId,
        classSectionId: sectionId,
        feeStructureId: structureId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
