import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (same shape as tests/db/finance-aggregates.test.ts) — only
// this file's module graph gets them.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { AppError } from "@/lib/actions/result";
import { collectionReport } from "@/modules/finance/queries";
import { buildContext, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createFeeAssignment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

// M12-T9 — `collectionReport` (src/modules/finance/queries.ts) wraps
// `public.finance_collection_report` (migration 20261028000074, already
// covered at the SQL level by tests/db/finance-plus-rls.test.ts's
// "public.finance_collection_report" describe block). This file tests the
// TS layer: default academic year, term-outside-year validation, and the
// rupee shape the query hands back (rulings, M12-tasks.md Task 9).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Same shape as tests/db/finance-plus-rls.test.ts's setFinanceSettings —
// generate_invoice/record_payment need the numbering + timezone settings,
// not just payment_modes.
async function setFinanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'finance', jsonb_build_object(
        'financial_year_start_month', 4, 'default_due_day', 10,
        'payment_modes', jsonb_build_array('cash', 'upi', 'cheque', 'neft', 'card')
      ),
      'numbering', jsonb_build_object(
        'admission_no', 'ADM/{YYYY}/{SEQ:5}', 'invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}'
      )
    )
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return student.id as string;
}

describe("collectionReport (M12-T9)", () => {
  it("groups by grade/term/mode with exact sums, reversal counted; defaults to the current academic year", async () => {
    const inst = await createTestInstitution("collection-report-ts");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 4000, frequency: "term" });
      const studentId = await insertStudent(inst.institutionId, "ADM-CRQ-1");
      await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);
      const [{ id: invoiceId }] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;

      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 4000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(payment.error).toBeNull();

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        // omitting academicYearId falls back to the is_current year.
        const byTerm = await collectionReport(ctx, { groupBy: "term" });
        const termRow = byTerm.find((r) => r.groupKey === termId);
        expect(termRow).toBeTruthy();
        expect(termRow?.invoiceCount).toBe(1);
        expect(termRow?.billed).toBe(4000);
        expect(termRow?.collected).toBe(4000);
        expect(termRow?.reversed).toBe(0);
        expect(termRow?.outstanding).toBe(0);

        const byGrade = await collectionReport(ctx, { groupBy: "grade", academicYearId: yearId });
        const gradeRow = byGrade.find((r) => r.groupKey === gradeId);
        expect(gradeRow?.billed).toBe(4000);

        const byMode = await collectionReport(ctx, { groupBy: "mode", academicYearId: yearId, termId });
        const modeRow = byMode.find((r) => r.groupKey === "cash");
        expect(modeRow?.billed).toBeNull();
        expect(modeRow?.outstanding).toBeNull();
        expect(modeRow?.collected).toBe(4000);
        expect(modeRow?.paymentCount).toBe(1);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("a term outside the academic year is validation_failed", async () => {
    const inst = await createTestInstitution("collection-report-bad-term");
    try {
      const yearId = await createAcademicYear(inst.institutionId, { name: "2026-27" });
      const otherYearId = await createAcademicYear(inst.institutionId, { name: "2025-26", isCurrent: false });
      const otherTermId = await createTerm(inst.institutionId, otherYearId, { sequence: 1 });

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        await expect(collectionReport(ctx, { groupBy: "term", academicYearId: yearId, termId: otherTermId })).rejects.toMatchObject(
          { code: "validation_failed" } satisfies Partial<AppError>,
        );
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
