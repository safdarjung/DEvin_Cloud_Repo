// M19-T5 — migration 0092 part 4: insight_src_fees, insight_src_admissions.
// Real signed-in clients + real RLS/grants, same pattern as
// insight-sources-academic.test.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createFeeAssignment, createFeeStructure } from "../helpers/factories";
import { plantAcademicSetup, plantAdmissions, plantFees, plantStudent } from "../helpers/insight-fixtures";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

// institutions.settings defaults to '{}' — application inserts go through
// app.next_sequence, which needs this pattern (same setup as
// admissions-actions.test.ts).
async function setNumberingSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('numbering', jsonb_build_object('application_no', 'APP/{YYYY}/{SEQ:5}'))
    where id = ${institutionId}
  `;
}

interface FeesSourceRow {
  overdue_now: string;
  overdue_then: string;
  overdue_count_now: number;
  overdue_count_then: number;
  concessions_recent: number;
  concessions_base: number;
  concessions_flagged: number;
}

describe("0092 part 4: insight_src_fees", () => {
  it("then-vs-now window, reversal restores outstanding, cancelled ignored, rupees rounded whole", async () => {
    const inst = await createTestInstitution("insight-src-fees");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const studentA = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const studentB = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const studentC = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const studentD = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const asOf = "2026-11-20";
      // then = asOf-28 = 2026-10-23.

      await plantFees(sql, inst.institutionId, setup.academicYearId, setup.termId, asOf, {
        invoices: [
          // A: paid in full 10 days ago (after "then") — outstanding_then
          // stays the full 5000 (payment not yet counted at "then"),
          // outstanding_now drops to 0 (fully paid) and drops out of "now".
          { studentId: studentA, total: 5000, dueDaysAgo: 40, payments: [{ amount: 5000, receivedDaysAgo: 10 }] },
          // B: paid in full 35 days ago (before "then", so subtracted at
          // both windows), then reversed 5 days ago (after "then", so the
          // reversal only restores outstanding at "now").
          {
            studentId: studentB,
            total: 3000,
            dueDaysAgo: 40,
            payments: [{ amount: 3000, receivedDaysAgo: 35, reversalDaysAgo: 5 }],
          },
          // C: cancelled — must never contribute despite being hugely overdue.
          { studentId: studentC, total: 10000, dueDaysAgo: 40, status: "cancelled" },
          // D: fractional outstanding (900.17), paid long before "then" so
          // it is identical in both windows — only the rupee rounding of
          // the aggregate sum is exercised here.
          { studentId: studentD, total: 1000.5, dueDaysAgo: 40, payments: [{ amount: 100.33, receivedDaysAgo: 100 }] },
        ],
      });

      const feeStructureId = await createFeeStructure(inst.institutionId, setup.academicYearId, setup.gradeId);
      const feeAssignmentId = await createFeeAssignment(inst.institutionId, studentA, feeStructureId, setup.academicYearId);
      await plantFees(sql, inst.institutionId, setup.academicYearId, setup.termId, asOf, {
        concessions: {
          feeAssignmentId,
          approvedBy: inst.users.owner.id,
          items: [
            { daysAgo: 5, kind: "hardship" }, // recent, flagged
            { daysAgo: 10, kind: "other" }, // recent, flagged
            { daysAgo: 15, kind: "sibling" }, // recent, not flagged
            { daysAgo: 60, kind: "merit" }, // base
            { daysAgo: 90, kind: "merit" }, // base
            { daysAgo: 200, kind: "merit" }, // outside both windows
          ],
        },
      });

      const { data, error } = await admin.rpc("insight_src_fees", { p_institution_id: inst.institutionId, p_as_of: asOf });
      expect(error).toBeNull();
      const [row] = data as FeesSourceRow[];

      // now: B(3000) + D(900.17) rounded = 3900; A excluded (fully paid), C excluded (cancelled).
      expect(Number(row.overdue_now)).toBe(3900);
      // then: A(5000) + D(900.17) rounded = 5900; B excluded (paid off before "then").
      expect(Number(row.overdue_then)).toBe(5900);
      expect(row.overdue_count_now).toBe(2);
      expect(row.overdue_count_then).toBe(2);

      expect(row.concessions_recent).toBe(3);
      expect(row.concessions_base).toBe(2);
      expect(row.concessions_flagged).toBe(2);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-fees-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_fees", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

interface AdmissionsSourceRow {
  stage: string;
  open_count: number;
  over_2: number;
  over_7: number;
  over_14: number;
}

describe("0092 part 4: insight_src_admissions", () => {
  it("over_2/7/14 per stage from planted updated_at; closed/converted/enrolled excluded; institution B ignored", async () => {
    const inst = await createTestInstitution("insight-src-admissions");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      await setNumberingSettings(inst.institutionId);
      const asOf = "2026-11-20";

      await plantAdmissions(sql, inst.institutionId, asOf, {
        enquiries: [
          // enquiry.new, threshold 2: 3 open, 2 stale (updated >= 2 days ago).
          { status: "new", createdDaysAgo: 1, updatedDaysAgo: 3 },
          { status: "new", createdDaysAgo: 1, updatedDaysAgo: 2 },
          { status: "new", createdDaysAgo: 1, updatedDaysAgo: 0 },
          // enquiry.contacted, threshold 7: 2 open, both stale.
          { status: "contacted", createdDaysAgo: 20, updatedDaysAgo: 8 },
          { status: "contacted", createdDaysAgo: 20, updatedDaysAgo: 10 },
          // noise: never returned regardless of dwell.
          { status: "converted", createdDaysAgo: 30, updatedDaysAgo: 30 },
          { status: "closed", createdDaysAgo: 30, updatedDaysAgo: 30 },
        ],
        applications: [
          // application.submitted, threshold 7: 1 open, stale.
          {
            status: "submitted",
            createdDaysAgo: 15,
            updatedDaysAgo: 10,
            gradeAppliedId: setup.gradeId,
            academicYearId: setup.academicYearId,
          },
          // application.interaction_scheduled, threshold 14: 1 open, stale.
          {
            status: "interaction_scheduled",
            createdDaysAgo: 20,
            updatedDaysAgo: 14,
            gradeAppliedId: setup.gradeId,
            academicYearId: setup.academicYearId,
          },
          // noise: enrolled is never returned.
          {
            status: "enrolled",
            createdDaysAgo: 40,
            updatedDaysAgo: 40,
            gradeAppliedId: setup.gradeId,
            academicYearId: setup.academicYearId,
          },
        ],
      });

      const instB = await createTestInstitution("insight-src-admissions-b");
      await plantAdmissions(sql, instB.institutionId, asOf, {
        enquiries: [{ status: "new", createdDaysAgo: 1, updatedDaysAgo: 5 }],
      });

      try {
        const { data, error } = await admin.rpc("insight_src_admissions", { p_institution_id: inst.institutionId, p_as_of: asOf });
        expect(error).toBeNull();
        const rows = data as AdmissionsSourceRow[];

        const enquiryNew = rows.find((r) => r.stage === "enquiry.new");
        expect(enquiryNew).toMatchObject({ open_count: 3, over_2: 2, over_7: 0, over_14: 0 });

        const enquiryContacted = rows.find((r) => r.stage === "enquiry.contacted");
        expect(enquiryContacted).toMatchObject({ open_count: 2, over_2: 0, over_7: 2, over_14: 0 });

        const appSubmitted = rows.find((r) => r.stage === "application.submitted");
        expect(appSubmitted).toMatchObject({ open_count: 1, over_2: 0, over_7: 1, over_14: 0 });

        const appInteraction = rows.find((r) => r.stage === "application.interaction_scheduled");
        expect(appInteraction).toMatchObject({ open_count: 1, over_2: 0, over_7: 0, over_14: 1 });

        expect(rows.some((r) => r.stage === "enquiry.converted")).toBe(false);
        expect(rows.some((r) => r.stage === "enquiry.closed")).toBe(false);
        expect(rows.some((r) => r.stage === "application.enrolled")).toBe(false);

        // Institution B never appears under institution A's row set, and
        // its own call never leaks A's rows either.
        const { data: dataB } = await admin.rpc("insight_src_admissions", { p_institution_id: instB.institutionId, p_as_of: asOf });
        const rowsB = dataB as AdmissionsSourceRow[];
        expect(rowsB.find((r) => r.stage === "enquiry.new")).toMatchObject({ open_count: 1 });
        expect(rowsB.some((r) => r.stage === "enquiry.contacted")).toBe(false);
      } finally {
        await instB.cleanup();
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-admissions-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_admissions", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
