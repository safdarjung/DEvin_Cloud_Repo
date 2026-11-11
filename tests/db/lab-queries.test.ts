// features-18 §D — src/modules/fabric/lab.queries.ts via lab.query-defs
// (callAs: real permission guard + real RLS through the 0125 security
// invoker functions). Fixture: one grade with 6 enrolled students (a
// visible cohort) and one with 4 (suppressed by the n >= 5 rule).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { labAnomaliesQuery, labFeeRiskQuery, labTrendBreaksQuery } from "@/modules/fabric/lab.query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function enrolStudents(institutionId: string, sectionId: string, yearId: string, count: number, tag: string): Promise<void> {
  for (let i = 0; i < count; i++) {
    const [student] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${institutionId}, ${`LAB-${tag}-${i}-${crypto.randomUUID().slice(0, 6)}`}, ${`LabKid${tag}${i}`}, '2014-01-01', 'other')
      returning id
    `;
    await createEnrolment(institutionId, student.id as string, sectionId, yearId, { rollNo: i + 1 });
  }
}

/** Grade VI-A with 6 students, Grade VII-A with 4. Returns the VI-A section id. */
async function seedLab(inst: TestInstitution): Promise<string> {
  const yearId = await createAcademicYear(inst.institutionId);
  const six = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
  const seven = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
  const sectionSix = await createClassSection(inst.institutionId, six, yearId);
  const sectionSeven = await createClassSection(inst.institutionId, seven, yearId);
  await enrolStudents(inst.institutionId, sectionSix, yearId, 6, "six");
  await enrolStudents(inst.institutionId, sectionSeven, yearId, 4, "seven");
  return sectionSix;
}

describe("lab queries (0125 via lab.query-defs)", () => {
  it("principal: the 6-student grade is a cohort, the 4-student grade is suppressed; anomalies list only the big section", async () => {
    const inst = await createTestInstitution("lab-q-principal");
    try {
      const sectionSix = await seedLab(inst);

      const fee = await callAs(inst, "principal", labFeeRiskQuery, {});
      expect(fee.ok).toBe(true);
      if (!fee.ok) return;
      expect(fee.data).toEqual([
        expect.objectContaining({ grade: "Grade VI", attendance_band: "no_data", students: 6, invoices: 0, overdue_invoices: 0, overdue_paise: 0 }),
      ]);

      const anomalies = await callAs(inst, "principal", labAnomaliesQuery, {});
      expect(anomalies.ok).toBe(true);
      if (!anomalies.ok) return;
      expect(anomalies.data.map((r) => r.class_section_id)).toEqual([sectionSix]);
      expect(anomalies.data[0]).toMatchObject({ students: 6, attendance_pct: null, attendance_z: null });
      expect(JSON.stringify(anomalies.data)).not.toContain("LabKid");

      const trends = await callAs(inst, "principal", labTrendBreaksQuery, {});
      expect(trends.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher and guardian: forbidden (no insight.read)", async () => {
    const inst = await createTestInstitution("lab-q-denied");
    try {
      for (const role of ["teacher", "guardian"] as const) {
        const result = await callAs(inst, role, labFeeRiskQuery, {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("forbidden");
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-tenant: A's principal calling the function with B's institution id gets nothing", async () => {
    await withTwoInstitutions(async (a, b) => {
      await seedLab(b);
      const { data, error } = await a.clientAs("principal").rpc("lab_fee_risk_cohorts", { p_institution_id: b.institutionId });
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const own = await b.clientAs("principal").rpc("lab_fee_risk_cohorts", { p_institution_id: b.institutionId });
      expect(own.data).toHaveLength(1);
    });
  });
});
