import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper, createAcademicYear, createGrade, createTerm } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// T-031 phase 2 — `public.enqueue_term_invoices` (20261028000017). Direct
// RPC tests (not through the `generateTermInvoices` action) per the packet:
// admin is forbidden, the call is idempotent, and cross-tenant ids are
// rejected.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("public.enqueue_term_invoices (T-031 phase 2)", () => {
  it("an accountant can enqueue; an admin is forbidden (finance.invoice.generate excludes admin)", async () => {
    const inst = await createTestInstitution("enqueue-term-invoices-roles");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });

      const adminResult = await inst.clientAs("admin").rpc("enqueue_term_invoices", {
        p_institution_id: inst.institutionId,
        p_term_id: termId,
        p_grade_id: null,
      });
      expect(adminResult.error).toBeTruthy();
      expect(adminResult.error?.message).toMatch(/forbidden/i);

      const accountantResult = await inst.clientAs("accountant").rpc("enqueue_term_invoices", {
        p_institution_id: inst.institutionId,
        p_term_id: termId,
        p_grade_id: null,
      });
      expect(accountantResult.error).toBeFalsy();
      const jobId = (accountantResult.data as { jobId: string })?.jobId;
      expect(jobId).toBeTruthy();

      const jobs = await sql`
        select type, payload from public.jobs where id = ${jobId}::uuid and institution_id = ${inst.institutionId}
      `;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.type).toBe("finance.generate_term_invoices");
      expect(jobs[0]?.payload).toMatchObject({ term_id: termId, grade_id: null });
    } finally {
      await inst.cleanup();
    }
  });

  it("is idempotent: enqueuing the same (term, grade) twice returns the same job", async () => {
    const inst = await createTestInstitution("enqueue-term-invoices-idempotent");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });

      const first = await inst.clientAs("accountant").rpc("enqueue_term_invoices", {
        p_institution_id: inst.institutionId,
        p_term_id: termId,
        p_grade_id: gradeId,
      });
      expect(first.error).toBeFalsy();

      const second = await inst.clientAs("accountant").rpc("enqueue_term_invoices", {
        p_institution_id: inst.institutionId,
        p_term_id: termId,
        p_grade_id: gradeId,
      });
      expect(second.error).toBeFalsy();

      const firstJobId = (first.data as { jobId: string })?.jobId;
      const secondJobId = (second.data as { jobId: string })?.jobId;
      expect(secondJobId).toBe(firstJobId);

      const count = await sql`
        select count(*)::int as n from public.jobs
        where institution_id = ${inst.institutionId} and type = 'finance.generate_term_invoices'
      `;
      expect(count[0]?.n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("rejects a term id that belongs to another institution (not_found, not a cross-tenant leak)", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearA = await createAcademicYear(instA.institutionId);
      const termA = await createTerm(instA.institutionId, yearA, { sequence: 1 });

      const result = await instB.clientAs("accountant").rpc("enqueue_term_invoices", {
        p_institution_id: instB.institutionId,
        p_term_id: termA,
        p_grade_id: null,
      });
      expect(result.error).toBeTruthy();
      expect(result.error?.message).toMatch(/not_found/i);

      // A grade from instA used against instB's own (valid) term must also be rejected.
      const gradeA = await createGrade(instA.institutionId);
      const yearB = await createAcademicYear(instB.institutionId);
      const termB = await createTerm(instB.institutionId, yearB, { sequence: 1 });
      const gradeResult = await instB.clientAs("accountant").rpc("enqueue_term_invoices", {
        p_institution_id: instB.institutionId,
        p_term_id: termB,
        p_grade_id: gradeA,
      });
      expect(gradeResult.error).toBeTruthy();
      expect(gradeResult.error?.message).toMatch(/not_found/i);
    });
  });
});
