// X01-T7 — studentLeave.list RLS-scoping (student_leave_requests, 0085 part
// 1). Mirrors tests/db/hr-queries.test.ts's callAs pattern and tests/db/
// student-leave-rls.test.ts's fixture shape (isoDate, staffIdFor,
// studentIdFor, guardianIdFor, makeBase). Rows are inserted directly via the
// raw `sql` connection (session_user=postgres bypasses the guard/RLS, lesson
// 5) rather than through the guardian/decide-RPC paths — those are already
// covered by student-leave-rls.test.ts; this file only exercises the read.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { studentLeaveListQuery } from "@/modules/student-leave/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

/** Year + grade VI + section A (class teacher = fixture's teacher) + fixture's student enrolled + fixture's guardian linked — mirrors tests/db/student-leave-rls.test.ts's makeBase. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await staffIdFor(inst.institutionId, "teacher");
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaff });
  const studentId = await studentIdFor(inst.institutionId);
  const guardianId = await guardianIdFor(inst.institutionId);
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return { yearId, gradeId, sectionId, teacherStaff, studentId, guardianId };
}

async function insertOtherStudent(institutionId: string, sectionId: string, academicYearId: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Not Mine', '2016-01-01', 'other')
    returning id
  `;
  await createEnrolment(institutionId, row.id as string, sectionId, academicYearId, { status: "active" });
  return row.id as string;
}

/** Direct insert bypassing the guard/RLS — see file header. */
async function insertLeave(
  institutionId: string,
  studentId: string,
  classSectionId: string,
  createdBy: string,
  overrides: Partial<{ startDate: string; endDate: string; status: string; decidedBy: string }> = {},
): Promise<string> {
  const startDate = overrides.startDate ?? isoDate(10);
  const endDate = overrides.endDate ?? startDate;
  const status = overrides.status ?? "pending";
  const decidedBy = overrides.decidedBy ?? null;
  const decidedAt = status === "pending" ? null : new Date().toISOString();
  const [row] = await sql`
    insert into public.student_leave_requests (institution_id, student_id, class_section_id, start_date, end_date, reason, status, created_by, decided_by, decided_at)
    values (${institutionId}, ${studentId}, ${classSectionId}, ${startDate}, ${endDate}, 'test fixture', ${status}, ${createdBy}, ${decidedBy}, ${decidedAt})
    returning id
  `;
  return row.id as string;
}

describe("studentLeave.list query (X01-T7)", () => {
  it("guardian sees only own children's rows", async () => {
    const inst = await createTestInstitution("sl-query-guardian");
    try {
      const base = await makeBase(inst);
      const ownLeaveId = await insertLeave(inst.institutionId, base.studentId, base.sectionId, inst.users.guardian.id);
      const otherStudentId = await insertOtherStudent(inst.institutionId, base.sectionId, base.yearId);
      await insertLeave(inst.institutionId, otherStudentId, base.sectionId, inst.users.admin.id);

      const result = await callAs(inst, "guardian", studentLeaveListQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((r) => r.id)).toEqual([ownLeaveId]);
      expect(result.data[0].studentName).toBe("Test");
      expect(result.data[0].classSection).toBe("VI-A");
      expect(result.data[0].days).toBe(1);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("class teacher sees own section's pending row", async () => {
    const inst = await createTestInstitution("sl-query-teacher-own");
    try {
      const base = await makeBase(inst);
      const leaveId = await insertLeave(inst.institutionId, base.studentId, base.sectionId, inst.users.guardian.id);

      const result = await callAs(inst, "teacher", studentLeaveListQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((r) => r.id)).toEqual([leaveId]);
      expect(result.data[0].status).toBe("pending");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher of another section sees none", async () => {
    const inst = await createTestInstitution("sl-query-teacher-other");
    try {
      const base = await makeBase(inst);
      // Section B has no class teacher, so only the admin trio (not the
      // fixture's "teacher", who is class teacher of section A only) can see
      // rows scoped to it.
      const sectionB = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B", classTeacherId: null });
      const otherStudentId = await insertOtherStudent(inst.institutionId, sectionB, base.yearId);
      await insertLeave(inst.institutionId, otherStudentId, sectionB, inst.users.admin.id);

      const result = await callAs(inst, "teacher", studentLeaveListQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("admin filters status: 'pending'", async () => {
    const inst = await createTestInstitution("sl-query-admin-filter");
    try {
      const base = await makeBase(inst);
      const pendingId = await insertLeave(inst.institutionId, base.studentId, base.sectionId, inst.users.guardian.id, { startDate: isoDate(10) });
      await insertLeave(inst.institutionId, base.studentId, base.sectionId, inst.users.guardian.id, {
        startDate: isoDate(20),
        status: "approved",
        decidedBy: inst.users.admin.id,
      });

      const result = await callAs(inst, "admin", studentLeaveListQuery, { status: "pending" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((r) => r.id)).toEqual([pendingId]);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("accountant -> forbidden", async () => {
    const inst = await createTestInstitution("sl-query-accountant");
    try {
      const result = await callAs(inst, "accountant", studentLeaveListQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
