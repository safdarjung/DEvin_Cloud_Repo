import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (same shape as tests/db/assignments.test.ts) — only this
// file's module graph gets them.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import { assignFeeStructure, generateTermInvoices, runGenerateTermInvoices, upsertFeeStructure } from "@/modules/finance/actions";
import { previewInvoice } from "@/modules/finance/proration";
import { generateTermInvoices as generateTermInvoicesHandler } from "@/modules/jobs/handlers/finance.generate_term_invoices";
import type { JobRow } from "@/modules/jobs/types";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Local fixture helpers (packet: put ad-hoc fixtures in the test file, not
// tests/helpers/factories.ts, which T-017 owns) — same shape as
// tests/db/finance.test.ts's own setFinanceSettings (T-030): institutions.
// settings defaults to '{}' (0002), so app.next_sequence raises
// invalid_state without a numbering pattern for invoice_no.
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

async function createStudent(institutionId: string, admissionNo?: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo ?? `ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

function fakeJob(institutionId: string, payload: Record<string, unknown>): JobRow {
  return {
    id: crypto.randomUUID(),
    institution_id: institutionId,
    type: "finance.generate_term_invoices",
    payload,
    idempotency_key: crypto.randomUUID(),
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_after: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** One institution with a Term 1, a grade, and `count` actively-enrolled students, ready for a fee assignment. */
async function setupTermWithStudents(
  inst: TestInstitution,
  count: number,
): Promise<{ yearId: string; gradeId: string; termId: string; sectionId: string; studentIds: string[] }> {
  await setFinanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });

  const studentIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const studentId = await createStudent(inst.institutionId);
    await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: i + 1 });
    studentIds.push(studentId);
  }

  return { yearId, gradeId, termId, sectionId, studentIds };
}

describe("finance structure/assignment actions (T-031)", () => {
  it("AC1: a second save with the same (year, grade, name) updates the structure and its components, not a duplicate", async () => {
    const inst = await createTestInstitution("finance-structure-upsert");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);

      const first = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [
          { head: "tuition", amount: 10000, frequency: "term" },
          { head: "transport", amount: 1500, frequency: "term" },
        ],
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [
          { head: "tuition", amount: 12000, frequency: "term" },
          { head: "transport", amount: 1500, frequency: "term" },
        ],
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.id).toBe(first.data.id);

      const structures = await sql`
        select id from public.fee_structures
        where institution_id = ${inst.institutionId} and academic_year_id = ${yearId}::uuid and grade_id = ${gradeId}::uuid and name = 'Standard'
      `;
      expect(structures).toHaveLength(1);

      const components = await sql`
        select head, amount from public.fee_components where fee_structure_id = ${first.data.id}::uuid order by head
      `;
      expect(components).toHaveLength(2);
      expect(components.find((c) => c.head === "tuition")?.amount).toBe("12000.00");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from upsertFeeStructure/assignFeeStructure/generateTermInvoices", async () => {
    const inst = await createTestInstitution("finance-teacher-forbidden");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const studentId = await createStudent(inst.institutionId);

      const structResult = await callAs(inst, "teacher", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [{ head: "tuition", amount: 10000, frequency: "term" }],
      });
      expect(structResult).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const assignResult = await callAs(inst, "teacher", assignFeeStructure, {
        studentId,
        feeStructureId: crypto.randomUUID(),
        academicYearId: yearId,
        concessions: [],
      });
      expect(assignResult).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const genResult = await callAs(inst, "teacher", generateTermInvoices, { termId, gradeId });
      expect(genResult).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("an admin may manage structures/assignments but is forbidden from generateTermInvoices (finance.invoice.generate excludes admin, T-030 CRITICAL)", async () => {
    const inst = await createTestInstitution("finance-admin-matrix");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });

      const structResult = await callAs(inst, "admin", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Admin-managed",
        components: [{ head: "tuition", amount: 5000, frequency: "term" }],
      });
      expect(structResult.ok).toBe(true);

      const genResult = await callAs(inst, "admin", generateTermInvoices, { termId, gradeId });
      expect(genResult).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("every id is verified against ctx.institution: a structure from another institution is not_found, not a cross-tenant leak", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearA = await createAcademicYear(instA.institutionId);
      const gradeA = await createGrade(instA.institutionId);
      const structA = await callAs(instA, "accountant", upsertFeeStructure, {
        academicYearId: yearA,
        gradeId: gradeA,
        name: "A-only",
        components: [{ head: "tuition", amount: 1000, frequency: "term" }],
      });
      expect(structA.ok).toBe(true);
      if (!structA.ok) return;

      const yearB = await createAcademicYear(instB.institutionId);
      const studentB = await createStudent(instB.institutionId);

      const result = await callAs(instB, "accountant", assignFeeStructure, {
        studentId: studentB,
        feeStructureId: structA.data.id,
        academicYearId: yearB,
        concessions: [],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });
});

describe("AC2: assignFeeStructure with a concession previews the same amount as the real generated invoice line (TS vs SQL parity)", () => {
  it("a 20% sibling concession on tuition matches app.generate_invoice's line exactly", async () => {
    const inst = await createTestInstitution("finance-concession-parity");
    try {
      const { yearId, gradeId, termId, studentIds } = await setupTermWithStudents(inst, 1);
      const studentId = studentIds[0];

      const components = [
        { head: "tuition" as const, amount: 10000, frequency: "term" as const },
        { head: "transport" as const, amount: 1500, frequency: "term" as const },
      ];
      const structResult = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components,
      });
      expect(structResult.ok).toBe(true);
      if (!structResult.ok) return;

      const assignResult = await callAs(inst, "accountant", assignFeeStructure, {
        studentId,
        feeStructureId: structResult.data.id,
        academicYearId: yearId,
        concessions: [{ kind: "sibling", head: "tuition", percent: 20, reason: "Sibling discount" }],
      });
      expect(assignResult.ok).toBe(true);

      // TS preview (proration.ts) — first-ever invoice, Term 1.
      const preview = previewInvoice(components, [{ head: "tuition", percent: 20, amount: null }], true, true);
      const tuitionPreview = preview.lines.find((l) => l.head === "tuition");
      expect(tuitionPreview?.concessionAmount).toBe(2000);

      const genResult = await callAs(inst, "accountant", generateTermInvoices, { termId, gradeId });
      expect(genResult).toMatchObject({ ok: true, data: { generated: 1, alreadyExisted: 0, failed: 0, remaining: 0 } });

      const [line] = await sql`
        select l.concession_amount, l.amount from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id
        where i.student_id = ${studentId}::uuid and l.head = 'tuition'
      `;
      expect(Number(line.concession_amount)).toBe(tuitionPreview?.concessionAmount);
      expect(Number(line.amount)).toBe(tuitionPreview?.amount);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("AC3: generateTermInvoices generates exactly one invoice per active student, and a rerun creates no duplicates", () => {
  it("via the action path (small-set synchronous)", async () => {
    const inst = await createTestInstitution("finance-generate-term-action");
    try {
      const { yearId, gradeId, termId, studentIds } = await setupTermWithStudents(inst, 3);

      const structResult = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [{ head: "tuition", amount: 8000, frequency: "term" }],
      });
      expect(structResult.ok).toBe(true);
      if (!structResult.ok) return;

      for (const studentId of studentIds) {
        const assign = await callAs(inst, "accountant", assignFeeStructure, {
          studentId,
          feeStructureId: structResult.data.id,
          academicYearId: yearId,
          concessions: [],
        });
        expect(assign.ok).toBe(true);
      }

      const first = await callAs(inst, "accountant", generateTermInvoices, { termId, gradeId });
      expect(first).toMatchObject({
        ok: true,
        data: { studentCount: 3, generated: 3, alreadyExisted: 0, failed: 0, remaining: 0 },
      });

      const invoicesAfterFirst = await sql`
        select id, student_id from public.invoices where term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(invoicesAfterFirst).toHaveLength(3);

      // Rerun: every student already has an invoice, so the second call
      // skips `generate_invoice` entirely (no duplicates) and reports it.
      const second = await callAs(inst, "accountant", generateTermInvoices, { termId, gradeId });
      expect(second).toMatchObject({
        ok: true,
        data: { studentCount: 3, generated: 0, alreadyExisted: 3, failed: 0, remaining: 0 },
      });

      const invoicesAfterSecond = await sql`
        select id, student_id from public.invoices where term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(invoicesAfterSecond).toHaveLength(3);
      // Same invoice ids before and after the rerun — not just the same count.
      expect(new Set(invoicesAfterSecond.map((i) => i.id))).toEqual(new Set(invoicesAfterFirst.map((i) => i.id)));
    } finally {
      await inst.cleanup();
    }
  });

  it("Bug fix: a grade with more students than one .in() chunk doesn't fail with 'URI too long', and alreadyExisted counts correctly across the chunk boundary", async () => {
    const inst = await createTestInstitution("finance-generate-term-large-grade");
    try {
      // 170 students: over the 150-per-chunk size in runGenerateTermInvoices,
      // so the existing-invoice check spans two chunks.
      const { gradeId, termId, studentIds } = await setupTermWithStudents(inst, 170);

      // Pre-seed an invoice directly for every 3rd student (spanning both
      // chunks), bypassing generate_invoice/fee structures entirely — this
      // test is about the existing-invoice lookup, not invoice generation.
      const alreadyInvoiced = studentIds.filter((_, i) => i % 3 === 0);
      for (const studentId of alreadyInvoiced) {
        await sql`
          insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, total)
          values (${inst.institutionId}::uuid, ${studentId}::uuid, ${
            (await sql`select academic_year_id from public.terms where id = ${termId}::uuid`)[0].academic_year_id
          }, ${termId}::uuid, ${`PRESEED/${studentId}`}, 100)
        `;
      }

      const result = await callAs(inst, "accountant", generateTermInvoices, { termId, gradeId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toMatchObject({
        studentCount: 170,
        alreadyExisted: alreadyInvoiced.length,
      });
    } finally {
      await inst.cleanup();
    }
  }, 60_000); // DBT-46: 170-student chunked lookup exceeds the 5s default under full-suite load.

  it("Fix round 1 (HIGH): a tiny budget stops early with remaining > 0, and a second call with the default budget finishes with no duplicates", async () => {
    const inst = await createTestInstitution("finance-generate-term-budget");
    try {
      const { yearId, gradeId, termId, studentIds } = await setupTermWithStudents(inst, 3);

      const structResult = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [{ head: "tuition", amount: 5000, frequency: "term" }],
      });
      expect(structResult.ok).toBe(true);
      if (!structResult.ok) return;
      for (const studentId of studentIds) {
        await callAs(inst, "accountant", assignFeeStructure, {
          studentId,
          feeStructureId: structResult.data.id,
          academicYearId: yearId,
          concessions: [],
        });
      }

      const ctx = await buildContext(inst, "accountant");
      const supabase = inst.clientAs("accountant") as unknown as Parameters<typeof runGenerateTermInvoices>[0];

      // runGenerateTermInvoices calls audit(), which goes through the
      // mocked @/lib/supabase/server too — set the acting client manually
      // since we're bypassing callAs (which does this for a full action).
      setActingClient(inst.clientAs("accountant") as unknown as SupabaseClient<Database>);
      let first: Awaited<ReturnType<typeof runGenerateTermInvoices>>;
      let second: Awaited<ReturnType<typeof runGenerateTermInvoices>>;
      try {
        // Budget of 0ms: the deadline has already passed before the loop's
        // first iteration, so it stops having processed no one.
        first = await runGenerateTermInvoices(supabase, ctx, { termId, gradeId }, 0);
      } finally {
        setActingClient(null);
      }
      expect(first).toMatchObject({ studentCount: 3, generated: 0, alreadyExisted: 0, failed: 0, remaining: 3 });

      const invoicesAfterFirst = await sql`
        select id from public.invoices where term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(invoicesAfterFirst).toHaveLength(0);

      setActingClient(inst.clientAs("accountant") as unknown as SupabaseClient<Database>);
      try {
        // Second call, default budget: finishes the remaining students, no duplicates.
        second = await runGenerateTermInvoices(supabase, ctx, { termId, gradeId });
      } finally {
        setActingClient(null);
      }
      expect(second).toMatchObject({ studentCount: 3, generated: 3, alreadyExisted: 0, failed: 0, remaining: 0 });

      const invoicesAfterSecond = await sql`
        select id, student_id from public.invoices where term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(invoicesAfterSecond).toHaveLength(3);
      expect(new Set(invoicesAfterSecond.map((i) => i.student_id))).toEqual(new Set(studentIds));
    } finally {
      await inst.cleanup();
    }
  });
});

describe("finance.generate_term_invoices job handler (T-031) — idempotency and tenant scoping", () => {
  it("via the real runner: enqueues, dispatches, and every active student gets one invoice; a second real job for the same term creates no duplicates", async () => {
    const inst = await createTestInstitution("finance-job-runner");
    try {
      const { yearId, gradeId, termId, studentIds } = await setupTermWithStudents(inst, 2);

      const structResult = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [{ head: "tuition", amount: 6000, frequency: "term" }],
      });
      expect(structResult.ok).toBe(true);
      if (!structResult.ok) return;
      for (const studentId of studentIds) {
        await callAs(inst, "accountant", assignFeeStructure, {
          studentId,
          feeStructureId: structResult.data.id,
          academicYearId: yearId,
          concessions: [],
        });
      }

      const key1 = `invoices:${termId}:all:test1`;
      await sql`select app.enqueue_job(${inst.institutionId}::uuid, 'finance.generate_term_invoices', ${sql.json({ term_id: termId, grade_id: null })}, ${key1})`;

      const summary = await runOnceCore({ workerId: "test-worker-invoices" }, createRunnerPorts(admin));
      expect(summary.succeeded).toBeGreaterThanOrEqual(1);

      const invoices = await sql`
        select student_id from public.invoices where term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(invoices).toHaveLength(2);

      // A second job for the same term (as if the handler's own batching had
      // re-run) must not create duplicates — generate_invoice's idempotency.
      const key2 = `invoices:${termId}:all:test2`;
      await sql`select app.enqueue_job(${inst.institutionId}::uuid, 'finance.generate_term_invoices', ${sql.json({ term_id: termId, grade_id: null })}, ${key2})`;
      await runOnceCore({ workerId: "test-worker-invoices" }, createRunnerPorts(admin));

      const invoicesAfterRerun = await sql`
        select id from public.invoices where term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(invoicesAfterRerun).toHaveLength(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("direct handler rerun (bypassing the runner's claim semantics) creates no duplicate invoices", async () => {
    const inst = await createTestInstitution("finance-handler-direct-rerun");
    try {
      const { yearId, gradeId, termId, studentIds } = await setupTermWithStudents(inst, 2);
      const structResult = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [{ head: "tuition", amount: 4000, frequency: "term" }],
      });
      if (!structResult.ok) throw new Error("fixture setup failed");
      for (const studentId of studentIds) {
        await callAs(inst, "accountant", assignFeeStructure, {
          studentId,
          feeStructureId: structResult.data.id,
          academicYearId: yearId,
          concessions: [],
        });
      }

      const job = fakeJob(inst.institutionId, { term_id: termId, grade_id: null });
      await generateTermInvoicesHandler(job, { admin });
      await generateTermInvoicesHandler(job, { admin });

      const invoices = await sql`
        select id from public.invoices where term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(invoices).toHaveLength(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("T-043 load-test finding: processes more than 1,000 active enrolments, not just PostgREST's default page", async () => {
    const inst = await createTestInstitution("finance-job-over-page-size");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });

      const structResult = await callAs(inst, "accountant", upsertFeeStructure, {
        academicYearId: yearId,
        gradeId,
        name: "Standard",
        components: [{ head: "tuition", amount: 1000, frequency: "term" }],
      });
      if (!structResult.ok) throw new Error("fixture setup failed");

      // Bulk SQL instead of the per-student factory/action loop used
      // elsewhere in this file — 1,001 rows need to clear PostgREST's
      // 1,000-row default page, and this only needs to be fast, not go
      // through RLS (it's fixture setup, not the thing under test).
      const STUDENT_COUNT = 1001;
      await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        select ${inst.institutionId}, 'ADM-OVERPAGE-' || g, 'Test', '2015-01-01', 'other'
        from generate_series(1, ${STUDENT_COUNT}) as g
      `;
      // Scoped to this test's own admission_no prefix, not `institution_id`
      // alone — `createTestInstitution` also creates its own "student" role
      // fixture in this institution, which must not be swept into these
      // bulk inserts (it would silently inflate the expected count by one).
      await sql`
        insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, roll_no, started_on, status)
        select ${inst.institutionId}, s.id, ${sectionId}, ${yearId}, row_number() over (order by s.id), '2026-04-01', 'active'
        from public.students s
        where s.institution_id = ${inst.institutionId} and s.admission_no like 'ADM-OVERPAGE-%'
      `;
      await sql`
        insert into public.fee_assignments (institution_id, student_id, fee_structure_id, academic_year_id)
        select ${inst.institutionId}, s.id, ${structResult.data.id}::uuid, ${yearId}
        from public.students s
        where s.institution_id = ${inst.institutionId} and s.admission_no like 'ADM-OVERPAGE-%'
      `;

      const job = fakeJob(inst.institutionId, { term_id: termId, grade_id: null });
      await generateTermInvoicesHandler(job, { admin });

      const [{ count }] = await sql`
        select count(*)::int as count from public.invoices
        where institution_id = ${inst.institutionId} and term_id = ${termId}::uuid and status <> 'cancelled'
      `;
      expect(count).toBe(STUDENT_COUNT);
    } finally {
      await inst.cleanup();
    }
  }, 60_000);

  it("is scoped to the job row's institution_id, not the payload: a term from another institution is rejected", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const { termId: termIdB } = await setupTermWithStudents(instB, 1);
      const job = fakeJob(instA.institutionId, { term_id: termIdB, grade_id: null });

      await expect(
        generateTermInvoicesHandler(job, { admin }),
      ).rejects.toThrow(/term not found/);
    });
  });

  it("rejects a malformed payload without echoing it in the error", async () => {
    const inst = await createTestInstitution("finance-job-bad-payload");
    try {
      const job = fakeJob(inst.institutionId, { term_id: "not-a-uuid" });
      await expect(
        generateTermInvoicesHandler(job, { admin }),
      ).rejects.toThrow("finance.generate_term_invoices: invalid payload");
    } finally {
      await inst.cleanup();
    }
  });
});
