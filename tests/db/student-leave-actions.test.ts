import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (leave-actions.test.ts pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { approveStudentLeave, cancelStudentLeave, rejectStudentLeave, requestStudentLeave } from "@/modules/student-leave/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { createAcademicYear, createClassSection, createEnrolment, createGrade, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X01-T6 — studentLeave.request / studentLeave.approve / studentLeave.reject
// / studentLeave.cancel (X01-tasks.md Task 6; migration 0085 part 1's
// student_leave_requests + decide_student_leave, built in T4). Fixture shape
// mirrors tests/db/leave-actions.test.ts and tests/db/student-leave-rls.test.ts.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

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

async function createBareStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
    returning id
  `;
  return row.id as string;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** year + section (class teacher = fixture's teacher) + fixture's student enrolled + fixture's guardian linked. */
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

describe("studentLeave.* actions (X01-T6)", () => {
  it("guardian requests leave for own child -> pending", async () => {
    const inst = await createTestInstitution("sla-request");
    try {
      const base = await makeBase(inst);
      const result = await callAs(inst, "guardian", requestStudentLeave, {
        studentId: base.studentId,
        startDate: isoDate(5),
        endDate: isoDate(6),
        reason: "Family function",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe("pending");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian requests leave for another family's child -> forbidden", async () => {
    const inst = await createTestInstitution("sla-other-child");
    try {
      const base = await makeBase(inst);
      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Not Mine', '2016-01-01', 'other')
        returning id
      `;
      await createEnrolment(inst.institutionId, otherStudent.id, base.sectionId, base.yearId, { status: "active" });

      const result = await callAs(inst, "guardian", requestStudentLeave, {
        studentId: otherStudent.id,
        startDate: isoDate(5),
        endDate: isoDate(6),
        reason: "Not my child",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("overlapping leave request -> conflict", async () => {
    const inst = await createTestInstitution("sla-overlap");
    try {
      const base = await makeBase(inst);
      const first = await callAs(inst, "guardian", requestStudentLeave, {
        studentId: base.studentId,
        startDate: isoDate(10),
        endDate: isoDate(12),
        reason: "First",
      });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "guardian", requestStudentLeave, {
        studentId: base.studentId,
        startDate: isoDate(11),
        endDate: isoDate(13),
        reason: "Overlaps first",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("class teacher approves -> approved", async () => {
    const inst = await createTestInstitution("sla-approve");
    try {
      const base = await makeBase(inst);
      const requested = await callAs(inst, "guardian", requestStudentLeave, {
        studentId: base.studentId,
        startDate: isoDate(20),
        endDate: isoDate(20),
        reason: "Secret reason",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const approved = await callAs(inst, "teacher", approveStudentLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.data.status).toBe("approved");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher of another section approving -> forbidden", async () => {
    const inst = await createTestInstitution("sla-wrong-teacher");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const otherStaff = await createBareStaff(inst.institutionId);
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: otherStaff });
      const studentId = await studentIdFor(inst.institutionId);
      const guardianId = await guardianIdFor(inst.institutionId);
      await createEnrolment(inst.institutionId, studentId, sectionB, yearId, { status: "active" });
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
        values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
      `;

      const requested = await callAs(inst, "guardian", requestStudentLeave, {
        studentId,
        startDate: isoDate(25),
        endDate: isoDate(25),
        reason: "Wrong teacher",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const approved = await callAs(inst, "teacher", approveStudentLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(false);
      if (approved.ok) return;
      expect(approved.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("reject then approve -> invalid_state", async () => {
    const inst = await createTestInstitution("sla-reject-approve");
    try {
      const base = await makeBase(inst);
      const requested = await callAs(inst, "guardian", requestStudentLeave, {
        studentId: base.studentId,
        startDate: isoDate(30),
        endDate: isoDate(30),
        reason: "Reject me",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const rejected = await callAs(inst, "teacher", rejectStudentLeave, { leaveId: requested.data.id });
      expect(rejected.ok).toBe(true);
      if (!rejected.ok) return;
      expect(rejected.data.status).toBe("rejected");

      const approved = await callAs(inst, "teacher", approveStudentLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(false);
      if (approved.ok) return;
      expect(approved.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian cancels own pending leave -> cancelled", async () => {
    const inst = await createTestInstitution("sla-cancel");
    try {
      const base = await makeBase(inst);
      const requested = await callAs(inst, "guardian", requestStudentLeave, {
        studentId: base.studentId,
        startDate: isoDate(40),
        endDate: isoDate(40),
        reason: "Changed my mind",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const cancelled = await callAs(inst, "guardian", cancelStudentLeave, { leaveId: requested.data.id });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.data.status).toBe("cancelled");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling studentLeave.request -> forbidden", async () => {
    const inst = await createTestInstitution("sla-teacher-request");
    try {
      const base = await makeBase(inst);
      const result = await callAs(inst, "teacher", requestStudentLeave, {
        studentId: base.studentId,
        startDate: isoDate(5),
        endDate: isoDate(6),
        reason: "Teacher attempt",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
