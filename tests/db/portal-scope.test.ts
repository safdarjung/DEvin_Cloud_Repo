import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — resolvePortalSelection/queries
// call createClient() from a plain query function, not a defineAction
// handler, so buildContext + setActingClient (not callAs) drive the real
// per-role RLS client here.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { listMyChildren, getMyStudent } from "@/modules/people/queries";
import { getStudentAttendanceSummary } from "@/modules/attendance/queries";
import { listInvoicesForStudent } from "@/modules/finance/queries";
import { listResultsForStudent } from "@/modules/exams/queries";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import { buildContext, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createTerm } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function createStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function linkGuardian(
  institutionId: string,
  guardianId: string,
  studentId: string,
  portalAccess: boolean,
): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'mother', ${portalAccess})
  `;
}

/** Runs `fn` with `@/lib/supabase/server`'s mock pointed at the role's real signed-in client — same pattern `callAs` uses for actions, applied here to plain query functions. */
async function asRole<T>(inst: TestInstitution, role: "guardian" | "student", fn: (ctx: Awaited<ReturnType<typeof buildContext>>) => Promise<T>): Promise<T> {
  const ctx = await buildContext(inst, role);
  setActingClient(inst.clientAs(role));
  try {
    return await fn(ctx);
  } finally {
    setActingClient(null);
  }
}

describe("listMyChildren (T-034, DBT-24 portal_access + C-11/C-54 BOLA)", () => {
  it("returns only the guardian's own children with portal_access = true, ordered by admission_no", async () => {
    const inst = await createTestInstitution("portal-children");
    try {
      const [guardianRow] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
      const visible = await createStudent(inst.institutionId, "ADM-PORTAL-002");
      const hidden = await createStudent(inst.institutionId, "ADM-PORTAL-001");
      await linkGuardian(inst.institutionId, guardianRow.guardian_id, visible, true);
      await linkGuardian(inst.institutionId, guardianRow.guardian_id, hidden, false);

      const children = await asRole(inst, "guardian", (ctx) => listMyChildren(ctx));

      expect(children.map((c) => c.id)).toEqual([visible]);
      expect(children.map((c) => c.id)).not.toContain(hidden);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-11/C-54: a guardian never sees another guardian's child, even in a different institution", async () => {
    const instA = await createTestInstitution("portal-children-a");
    const instB = await createTestInstitution("portal-children-b");
    try {
      const [guardianA] = await sql`select guardian_id from public.memberships where institution_id = ${instA.institutionId} and role = 'guardian'`;
      const [guardianB] = await sql`select guardian_id from public.memberships where institution_id = ${instB.institutionId} and role = 'guardian'`;
      const childA = await createStudent(instA.institutionId, "ADM-A-001");
      const childB = await createStudent(instB.institutionId, "ADM-B-001");
      await linkGuardian(instA.institutionId, guardianA.guardian_id, childA, true);
      await linkGuardian(instB.institutionId, guardianB.guardian_id, childB, true);

      const childrenOfA = await asRole(instA, "guardian", (ctx) => listMyChildren(ctx));
      expect(childrenOfA.map((c) => c.id)).toEqual([childA]);
      expect(childrenOfA.map((c) => c.id)).not.toContain(childB);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("getMyStudent returns the student role's own record (DBT-05's shared portal UI)", async () => {
    const inst = await createTestInstitution("portal-self");
    try {
      const ctx = await buildContext(inst, "student");
      const me = await asRole(inst, "student", (c) => getMyStudent(c));
      expect(me?.id).toBe(ctx.membership.studentId);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("portal tab queries stay RLS-scoped to the guardian's own child (C-54)", () => {
  it("attendance/finance/exam/assignment reads return data for own child, nothing for another guardian's child", async () => {
    const instA = await createTestInstitution("portal-tabs-a");
    const instB = await createTestInstitution("portal-tabs-b");
    try {
      const [guardianA] = await sql`select guardian_id from public.memberships where institution_id = ${instA.institutionId} and role = 'guardian'`;
      const childA = await createStudent(instA.institutionId, "ADM-TABS-A");
      const childB = await createStudent(instB.institutionId, "ADM-TABS-B");
      await linkGuardian(instA.institutionId, guardianA.guardian_id, childA, true);

      const yearId = await createAcademicYear(instA.institutionId);
      const termId = await createTerm(instA.institutionId, yearId, { sequence: 1 });

      const ctx = await buildContext(instA, "guardian");
      setActingClient(instA.clientAs("guardian"));
      try {
        // Own child: no RLS error thrown (empty results/zero attendance are
        // fine — no fixtures for attendance/invoices/exams/assignments here,
        // this is a scope check, not a data-presence check).
        await expect(getStudentAttendanceSummary(ctx, childA, termId)).resolves.toMatchObject({ totalInDenominator: 0 });
        await expect(listInvoicesForStudent(ctx, childA)).resolves.toEqual([]);
        await expect(listResultsForStudent(ctx, childA)).resolves.toEqual([]);
        await expect(listStudentAssignments(ctx, childA)).resolves.toEqual([]);

        // Another institution's child: RLS scopes the row set to nothing,
        // never an error (BOLA — not_found/0 rows, per 07 §6 C-10..C-14).
        await expect(getStudentAttendanceSummary(ctx, childB, termId)).resolves.toMatchObject({ totalInDenominator: 0 });
        await expect(listInvoicesForStudent(ctx, childB)).resolves.toEqual([]);
        await expect(listResultsForStudent(ctx, childB)).resolves.toEqual([]);
        await expect(listStudentAssignments(ctx, childB)).resolves.toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });
});
