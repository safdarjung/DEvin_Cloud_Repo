import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
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

async function studentMembership(institutionId: string) {
  const [row] = await sql`
    select user_id, student_id from public.memberships
    where institution_id = ${institutionId} and role = 'student'
  `;
  return { userId: row.user_id as string, studentId: row.student_id as string };
}

async function guardianMembership(institutionId: string) {
  const [row] = await sql`
    select user_id, guardian_id from public.memberships
    where institution_id = ${institutionId} and role = 'guardian'
  `;
  return { userId: row.user_id as string, guardianId: row.guardian_id as string };
}

async function linkGuardian(
  institutionId: string,
  guardianId: string,
  studentId: string,
  isPrimary: boolean,
) {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', ${isPrimary})
  `;
}

async function insertSibling(institutionId: string, admissionNo: string) {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Sibling', '2017-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function insertInvitation(institutionId: string, studentId: string) {
  await sql`
    insert into public.invitations (institution_id, email, role, student_id, token_hash, expires_at)
    values (
      ${institutionId}, 'pending-exit@test.coolskool.test', 'student', ${studentId},
      ${`th-${crypto.randomUUID()}`}, now() + interval '7 days'
    )
  `;
}

async function insertInvoice(
  institutionId: string,
  studentId: string,
  academicYearId: string,
  termId: string,
) {
  await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, subtotal, total, paid_total)
    values (
      ${institutionId}, ${studentId}, ${academicYearId}, ${termId},
      ${`INV-${crypto.randomUUID().slice(0, 8)}`}, 'part_paid', 5000, 5000, 2000
    )
  `;
}

describe("migration 0076 part 3: public.exit_student", () => {
  it("withdraws a student: terminal states, history row, tc_no sequence, snapshot, dues, membership and invitation", async () => {
    const inst = await createTestInstitution("lc-exit-basic");
    try {
      const { studentId } = await studentMembership(inst.institutionId);
      const { guardianId } = await guardianMembership(inst.institutionId);
      await linkGuardian(inst.institutionId, guardianId, studentId, true);

      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const enrolmentId = await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 3 });
      const termId = await createTerm(inst.institutionId, yearId);
      await insertInvoice(inst.institutionId, studentId, yearId, termId);
      await insertInvitation(inst.institutionId, studentId);

      const { data, error } = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });
      expect(error).toBeNull();
      const year = new Date().getFullYear();
      expect(data.tc_no).toBe(`TC/${year}/00001`);

      const [enrolment] = await sql`select * from public.enrolments where id = ${enrolmentId}`;
      expect(enrolment.status).toBe("withdrawn");
      expect(enrolment.ended_on.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));

      const [student] = await sql`select status from public.students where id = ${studentId}`;
      expect(student.status).toBe("withdrawn");

      const [history] = await sql`
        select * from public.enrolment_status_history where enrolment_id = ${enrolmentId} order by created_at desc limit 1
      `;
      expect(history.from_status).toBe("active");
      expect(history.to_status).toBe("withdrawn");
      expect(history.changed_by).toBe(inst.users.admin.id);

      const [event] = await sql`select * from public.student_lifecycle_events where student_id = ${studentId}`;
      expect(event.kind).toBe("withdrawn");
      expect(event.tc_no).toBe(data.tc_no);
      expect(event.tc_snapshot.admission_no).toBeDefined();
      expect(event.tc_snapshot.grade).toBeDefined();
      expect(event.tc_snapshot.section).toBe("A");
      expect(event.tc_snapshot.academic_year).toBeDefined();
      expect(event.tc_snapshot.primary_guardian_name).toContain("Test Guardian");
      expect(Number(event.tc_snapshot.dues_outstanding)).toBe(3000);

      const [membership] = await sql`
        select status from public.memberships where institution_id = ${inst.institutionId} and role = 'student'
      `;
      expect(membership.status).toBe("disabled");

      const [invitation] = await sql`
        select revoked_at from public.invitations where institution_id = ${inst.institutionId} and student_id = ${studentId}
      `;
      expect(invitation.revoked_at).not.toBeNull();

      const [guardianRow] = await sql`
        select status from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      expect(guardianRow.status).toBe("disabled");

      // A second exit in the same institution gets the next sequence number.
      const secondStudentId = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-SECOND-${crypto.randomUUID().slice(0, 6)}`}, 'Second', '2016-01-01', 'other')
        returning id
      `.then(([row]) => row.id as string);
      const second = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: secondStudentId,
        p_kind: "transferred_out",
        p_reason: "Moving to another school",
        p_destination_school: "Greenwood High",
      });
      expect(second.error).toBeNull();
      expect(second.data.tc_no).toBe(`TC/${year}/00002`);
    } finally {
      await inst.cleanup();
    }
  });

  it("a guardian with an active sibling keeps an active membership", async () => {
    const inst = await createTestInstitution("lc-exit-sibling");
    try {
      const { studentId } = await studentMembership(inst.institutionId);
      const { guardianId } = await guardianMembership(inst.institutionId);
      await linkGuardian(inst.institutionId, guardianId, studentId, true);
      const siblingId = await insertSibling(inst.institutionId, `ADM-SIB-${crypto.randomUUID().slice(0, 6)}`);
      await linkGuardian(inst.institutionId, guardianId, siblingId, false);

      const { error } = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });
      expect(error).toBeNull();

      const [guardianRow] = await sql`
        select status from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      expect(guardianRow.status).toBe("active");
    } finally {
      await inst.cleanup();
    }
  });

  it("transferred_out without a destination school is validation_failed", async () => {
    const inst = await createTestInstitution("lc-exit-no-destination");
    try {
      const { studentId } = await studentMembership(inst.institutionId);
      const { error } = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "transferred_out",
        p_reason: "Moving to another school",
      });
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("a future left_on is validation_failed", async () => {
    const inst = await createTestInstitution("lc-exit-future-left-on");
    try {
      const { studentId } = await studentMembership(inst.institutionId);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { error } = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
        p_left_on: tomorrow,
      });
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("exiting an already-exited student is invalid_state", async () => {
    const inst = await createTestInstitution("lc-exit-twice");
    try {
      const { studentId } = await studentMembership(inst.institutionId);
      const first = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });
      expect(second.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("two concurrent exits of the same student never both succeed (no double TC)", async () => {
    const inst = await createTestInstitution("lc-exit-race");
    try {
      const { studentId } = await studentMembership(inst.institutionId);

      const [first, second] = await Promise.all([
        inst.clientAs("admin").rpc("exit_student", {
          p_student_id: studentId,
          p_kind: "withdrawn",
          p_reason: "Family relocating to another city",
        }),
        inst.clientAs("admin").rpc("exit_student", {
          p_student_id: studentId,
          p_kind: "withdrawn",
          p_reason: "Family relocating to another city",
        }),
      ]);

      const results = [first, second];
      const succeeded = results.filter((r) => r.error === null);
      const failed = results.filter((r) => r.error !== null);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].error?.message).toContain("code:invalid_state");

      const events = await sql`select * from public.student_lifecycle_events where student_id = ${studentId}`;
      expect(events).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from exiting a student", async () => {
    const inst = await createTestInstitution("lc-exit-forbidden");
    try {
      const { studentId } = await studentMembership(inst.institutionId);
      const { error } = await inst.clientAs("teacher").rpc("exit_student", {
        p_student_id: studentId,
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });
      expect(error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("an unknown student id is not_found", async () => {
    const inst = await createTestInstitution("lc-exit-not-found");
    try {
      const { error } = await inst.clientAs("admin").rpc("exit_student", {
        p_student_id: crypto.randomUUID(),
        p_kind: "withdrawn",
        p_reason: "Family relocating to another city",
      });
      expect(error?.message).toContain("code:not_found");
    } finally {
      await inst.cleanup();
    }
  });
});
