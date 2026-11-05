import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X01-T4 — migration 0085 part 1: student_leave_requests + guard +
// decide_student_leave + app.premark_student_leave. Same fixture shape as
// tests/db/staff-leave-rls.test.ts (0070) and tests/db/attendance-schema.test.ts
// (institution settings need `attendance.statuses` set explicitly — a fresh
// createTestInstitution institution's `settings` only carries `modules`).

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const ATTENDANCE_STATUSES_WITH_OL = [
  { code: "P", label: "Present" },
  { code: "A", label: "Absent" },
  { code: "L", label: "Late" },
  { code: "HD", label: "Half day" },
  { code: "OL", label: "On leave" },
];
const ATTENDANCE_STATUSES_NO_OL = ATTENDANCE_STATUSES_WITH_OL.filter((s) => s.code !== "OL");

async function setAttendanceStatuses(institutionId: string, statuses = ATTENDANCE_STATUSES_WITH_OL): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(statuses)}::jsonb))
    where id = ${institutionId}
  `;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function isSunday(offsetDays: number): boolean {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.getUTCDay() === 0;
}

/** Nearest offset to `start` (searching in `step` direction) that isn't a Sunday. */
function safeOffset(start: number, step: 1 | -1 = 1): number {
  let offset = start;
  while (isSunday(offset)) offset += step;
  return offset;
}

/** An offset in [-7, -1] that IS a Sunday — always exists in a 7-day window. */
function pastSundayOffset(): number {
  for (let offset = -7; offset <= -1; offset++) {
    if (isSunday(offset)) return offset;
  }
  throw new Error("no Sunday found in [-7,-1]");
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

async function createBareStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
    returning id
  `;
  return row.id as string;
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

describe("student leave migration (0085 part 1) — student_leave_requests RLS + guard", () => {
  it("guardian applies for own child -> pending, section from enrolment, created_by self even when spoofed", async () => {
    const inst = await createTestInstitution("sl-own-child");
    try {
      const base = await makeBase(inst);
      const otherUser = inst.users.admin.id; // spoofed created_by target

      const { data, error } = await inst
        .clientAs("guardian")
        .from("student_leave_requests")
        .insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(), // spoofed; guard overwrites from enrolment
          start_date: isoDate(safeOffset(5)),
          end_date: isoDate(safeOffset(5)),
          reason: "Family function",
          status: "approved", // spoofed
          created_by: otherUser, // spoofed
        })
        .select("status, created_by, class_section_id")
        .single();

      expect(error).toBeNull();
      expect(data?.status).toBe("pending");
      expect(data?.created_by).toBe(inst.users.guardian.id);
      expect(data?.class_section_id).toBe(base.sectionId);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("guardian applies for another family's child -> 42501", async () => {
    const inst = await createTestInstitution("sl-other-child");
    try {
      const base = await makeBase(inst);
      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Not Mine', '2016-01-01', 'other')
        returning id
      `;
      // Must be actively enrolled so the guard's section lookup succeeds and
      // the RLS with_check (guardian_student_ids) is what rejects — not an
      // earlier "no active enrolment" validation_failed.
      await createEnrolment(inst.institutionId, otherStudent.id, base.sectionId, base.yearId, { status: "active" });

      const { error } = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: otherStudent.id,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(5),
        end_date: isoDate(5),
        reason: "Not my child",
      });

      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("start date 8 days back -> validation_failed", async () => {
    const inst = await createTestInstitution("sl-too-old");
    try {
      const base = await makeBase(inst);

      const { error } = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(-8),
        end_date: isoDate(-7),
        reason: "Too far back",
      });

      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("overlapping pending leave for the same student -> conflict", async () => {
    const inst = await createTestInstitution("sl-overlap");
    try {
      const base = await makeBase(inst);

      const first = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(10),
        end_date: isoDate(12),
        reason: "First",
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(11),
        end_date: isoDate(13),
        reason: "Overlaps first",
      });
      expect(second.error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("class teacher approves -> approved + audit_events row without the reason", async () => {
    const inst = await createTestInstitution("sl-approve");
    try {
      const base = await makeBase(inst);
      await setAttendanceStatuses(inst.institutionId);

      const inserted = await inst
        .clientAs("guardian")
        .from("student_leave_requests")
        .insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: isoDate(20),
          end_date: isoDate(20),
          reason: "Secret reason text",
        })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      const leaveId = inserted.data!.id as string;

      const approve = await inst.clientAs("teacher").rpc("decide_student_leave", {
        p_leave_id: leaveId,
        p_decision: "approved",
      });
      expect(approve.error).toBeNull();
      expect(approve.data.status).toBe("approved");

      const [audit] = await sql`
        select before, after from public.audit_events
        where entity_id = ${leaveId}::uuid and action = 'student_leave.approved'
      `;
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit.before)).not.toContain("Secret reason text");
      expect(JSON.stringify(audit.after)).not.toContain("Secret reason text");
      expect(audit.after.status).toBe("approved");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher of another section deciding -> forbidden", async () => {
    const inst = await createTestInstitution("sl-wrong-teacher");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const teacherStaff = await staffIdFor(inst.institutionId, "teacher");
      await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff });
      const otherStaff = await createBareStaff(inst.institutionId);
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: otherStaff });

      const studentId = await studentIdFor(inst.institutionId);
      const guardianId = await guardianIdFor(inst.institutionId);
      await createEnrolment(inst.institutionId, studentId, sectionB, yearId, { status: "active" });
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
        values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
      `;

      const inserted = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(25),
        end_date: isoDate(25),
        reason: "Wrong teacher",
      }).select("id").single();
      expect(inserted.error).toBeNull();

      const decide = await inst.clientAs("teacher").rpc("decide_student_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "approved",
      });
      expect(decide.error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("guardian calling decide_student_leave to approve -> forbidden", async () => {
    const inst = await createTestInstitution("sl-guardian-decide");
    try {
      const base = await makeBase(inst);

      const inserted = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(30),
        end_date: isoDate(30),
        reason: "Guardian self-approve attempt",
      }).select("id").single();
      expect(inserted.error).toBeNull();

      const approve = await inst.clientAs("guardian").rpc("decide_student_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "approved",
      });
      expect(approve.error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("approving an already-approved leave -> invalid_state", async () => {
    const inst = await createTestInstitution("sl-double-approve");
    try {
      const base = await makeBase(inst);
      await setAttendanceStatuses(inst.institutionId);

      const inserted = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(35),
        end_date: isoDate(35),
        reason: "Double approve",
      }).select("id").single();
      const leaveId = inserted.data!.id as string;

      const first = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leaveId, p_decision: "approved" });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leaveId, p_decision: "approved" });
      expect(second.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("requester cancels own pending leave -> cancelled", async () => {
    const inst = await createTestInstitution("sl-cancel-own");
    try {
      const base = await makeBase(inst);

      const inserted = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(40),
        end_date: isoDate(40),
        reason: "Changed my mind",
      }).select("id").single();

      const cancel = await inst.clientAs("guardian").rpc("decide_student_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "cancelled",
      });
      expect(cancel.error).toBeNull();
      expect(cancel.data.status).toBe("cancelled");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("another guardian cancelling someone else's leave -> not_found or forbidden", async () => {
    const inst = await createTestInstitution("sl-cancel-other");
    try {
      const base = await makeBase(inst);

      const inserted = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(45),
        end_date: isoDate(45),
        reason: "Not yours to cancel",
      }).select("id").single();

      // admin isn't the requester and isn't cancelling their own leave.
      const cancel = await inst.clientAs("admin").rpc("decide_student_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "cancelled",
      });
      expect(cancel.error?.message).toMatch(/code:(not_found|forbidden)/);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("direct UPDATE of status outside the RPC is denied", async () => {
    const inst = await createTestInstitution("sl-direct-update");
    try {
      const base = await makeBase(inst);

      const inserted = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(50),
        end_date: isoDate(50),
        reason: "Direct update attempt",
      }).select("id").single();
      const leaveId = inserted.data!.id as string;

      const update = await inst
        .clientAs("teacher")
        .from("student_leave_requests")
        .update({ status: "approved" })
        .eq("id", leaveId)
        .select("id");

      expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);

      const [row] = await sql`select status from public.student_leave_requests where id = ${leaveId}::uuid`;
      expect(row.status).toBe("pending");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("jobs: one notify.student_leave_decided on approve and on reject, none on cancel", async () => {
    const inst = await createTestInstitution("sl-jobs");
    try {
      const base = await makeBase(inst);
      await setAttendanceStatuses(inst.institutionId);

      const approved = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(60),
        end_date: isoDate(60),
        reason: "Approve path",
      }).select("id").single();
      await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: approved.data!.id, p_decision: "approved" });

      const rejected = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(65),
        end_date: isoDate(65),
        reason: "Reject path",
      }).select("id").single();
      await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: rejected.data!.id, p_decision: "rejected" });

      const cancelled = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(70),
        end_date: isoDate(70),
        reason: "Cancel path",
      }).select("id").single();
      await inst.clientAs("guardian").rpc("decide_student_leave", { p_leave_id: cancelled.data!.id, p_decision: "cancelled" });

      const approvedJobs = await sql`select count(*) from public.jobs where type = 'notify.student_leave_decided' and idempotency_key = ${`student_leave:${approved.data!.id}`}`;
      expect(Number(approvedJobs[0].count)).toBe(1);
      const rejectedJobs = await sql`select count(*) from public.jobs where type = 'notify.student_leave_decided' and idempotency_key = ${`student_leave:${rejected.data!.id}`}`;
      expect(Number(rejectedJobs[0].count)).toBe(1);
      const cancelledJobs = await sql`select count(*) from public.jobs where type = 'notify.student_leave_decided' and idempotency_key = ${`student_leave:${cancelled.data!.id}`}`;
      expect(Number(cancelledJobs[0].count)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("reads: admin all, class teacher own section, guardian own child, student own, accountant none", async () => {
    const inst = await createTestInstitution("sl-read-scope");
    try {
      const base = await makeBase(inst);

      const inserted = await inst.clientAs("guardian").from("student_leave_requests").insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: crypto.randomUUID(),
        start_date: isoDate(80),
        end_date: isoDate(80),
        reason: "Scope check",
      });
      expect(inserted.error).toBeNull();

      expect((await inst.clientAs("admin").from("student_leave_requests").select("id")).data).toHaveLength(1);
      expect((await inst.clientAs("teacher").from("student_leave_requests").select("id")).data).toHaveLength(1);
      expect((await inst.clientAs("guardian").from("student_leave_requests").select("id")).data).toHaveLength(1);
      expect((await inst.clientAs("student").from("student_leave_requests").select("id")).data).toHaveLength(1);
      expect((await inst.clientAs("accountant").from("student_leave_requests").select("id")).data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  describe("app.premark_student_leave (called from decide_student_leave's approved branch)", () => {
    it("previous school day's submitted session with A -> OL + one correction + attendance.corrected audit", async () => {
      const inst = await createTestInstitution("sl-premark-submitted");
      try {
        const base = await makeBase(inst);
        await setAttendanceStatuses(inst.institutionId);
        const day = isoDate(safeOffset(-3, -1));

        const sessionId = await createAttendanceSession(inst.institutionId, base.sectionId, { date: day, status: "submitted" });
        const [record] = await sql`
          insert into public.attendance_records (institution_id, session_id, student_id, status)
          values (${inst.institutionId}, ${sessionId}::uuid, ${base.studentId}::uuid, 'A')
          returning id
        `;

        const leave = await inst.clientAs("guardian").from("student_leave_requests").insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: day,
          end_date: day,
          reason: "Previous school day",
        }).select("id").single();

        const approve = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leave.data!.id, p_decision: "approved" });
        expect(approve.error).toBeNull();

        const [afterRecord] = await sql`select status from public.attendance_records where id = ${record.id}::uuid`;
        expect(afterRecord.status).toBe("OL");

        const corrections = await sql`select old_status, new_status, reason from public.attendance_corrections where record_id = ${record.id}::uuid`;
        expect(corrections).toHaveLength(1);
        expect(corrections[0].old_status).toBe("A");
        expect(corrections[0].new_status).toBe("OL");
        expect(corrections[0].reason).toBe("Student leave approved");

        const [audit] = await sql`select before, after from public.audit_events where entity_id = ${record.id}::uuid and action = 'attendance.corrected'`;
        expect(audit).toBeDefined();
        expect(audit.before.status).toBe("A");
        expect(audit.after.status).toBe("OL");
      } finally {
        await inst.cleanup();
      }
    }, 20_000);

    it("today's open session -> record marked OL", async () => {
      const inst = await createTestInstitution("sl-premark-open-today");
      try {
        const base = await makeBase(inst);
        await setAttendanceStatuses(inst.institutionId);
        const day = isoDate(safeOffset(0));

        const sessionId = await createAttendanceSession(inst.institutionId, base.sectionId, { date: day, status: "open" });

        const leave = await inst.clientAs("guardian").from("student_leave_requests").insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: day,
          end_date: day,
          reason: "Today",
        }).select("id").single();

        const approve = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leave.data!.id, p_decision: "approved" });
        expect(approve.error).toBeNull();

        const [record] = await sql`select status from public.attendance_records where session_id = ${sessionId}::uuid and student_id = ${base.studentId}::uuid`;
        expect(record.status).toBe("OL");
      } finally {
        await inst.cleanup();
      }
    }, 20_000);

    it("next school day with no session -> opens a session + records OL", async () => {
      const inst = await createTestInstitution("sl-premark-no-session");
      try {
        const base = await makeBase(inst);
        await setAttendanceStatuses(inst.institutionId);
        const day = isoDate(safeOffset(5));

        const leave = await inst.clientAs("guardian").from("student_leave_requests").insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: day,
          end_date: day,
          reason: "Next school day",
        }).select("id").single();

        const approve = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leave.data!.id, p_decision: "approved" });
        expect(approve.error).toBeNull();
        expect(approve.data.decision_note === null || typeof approve.data.decision_note === "string").toBe(true);

        const [session] = await sql`select id, status, marked_by from public.attendance_sessions where class_section_id = ${base.sectionId}::uuid and date = ${day} and period_id is null`;
        expect(session).toBeDefined();
        expect(session.status).toBe("open");
        expect(session.marked_by).toBeNull();

        const [record] = await sql`select status from public.attendance_records where session_id = ${session.id}::uuid and student_id = ${base.studentId}::uuid`;
        expect(record.status).toBe("OL");
      } finally {
        await inst.cleanup();
      }
    }, 20_000);

    it("a past Sunday with no session -> nothing created", async () => {
      const inst = await createTestInstitution("sl-premark-sunday");
      try {
        const base = await makeBase(inst);
        await setAttendanceStatuses(inst.institutionId);
        const day = isoDate(pastSundayOffset());

        const leave = await inst.clientAs("guardian").from("student_leave_requests").insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: day,
          end_date: day,
          reason: "Past Sunday",
        }).select("id").single();

        const approve = await inst.clientAs("admin").rpc("decide_student_leave", { p_leave_id: leave.data!.id, p_decision: "approved" });
        expect(approve.error).toBeNull();

        const sessions = await sql`select count(*) from public.attendance_sessions where class_section_id = ${base.sectionId}::uuid and date = ${day}`;
        expect(Number(sessions[0].count)).toBe(0);
      } finally {
        await inst.cleanup();
      }
    }, 20_000);

    it("a holiday -> no session created", async () => {
      const inst = await createTestInstitution("sl-premark-holiday");
      try {
        const base = await makeBase(inst);
        await setAttendanceStatuses(inst.institutionId);
        const day = isoDate(safeOffset(6));

        await sql`
          insert into public.academic_calendar_events (institution_id, academic_year_id, kind, title, starts_on, ends_on, audience, created_by)
          values (${inst.institutionId}, ${base.yearId}::uuid, 'holiday', 'Festival', ${day}, ${day}, 'all', ${inst.users.admin.id}::uuid)
        `;

        const leave = await inst.clientAs("guardian").from("student_leave_requests").insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: day,
          end_date: day,
          reason: "Holiday",
        }).select("id").single();

        const approve = await inst.clientAs("admin").rpc("decide_student_leave", { p_leave_id: leave.data!.id, p_decision: "approved" });
        expect(approve.error).toBeNull();

        const sessions = await sql`select count(*) from public.attendance_sessions where class_section_id = ${base.sectionId}::uuid and date = ${day}`;
        expect(Number(sessions[0].count)).toBe(0);
      } finally {
        await inst.cleanup();
      }
    }, 20_000);

    it("a period session is untouched; a separate daily session is created", async () => {
      const inst = await createTestInstitution("sl-premark-period");
      try {
        const base = await makeBase(inst);
        await setAttendanceStatuses(inst.institutionId);
        const day = isoDate(safeOffset(7));

        const [period] = await sql`
          insert into public.periods (institution_id, seq, name, starts_at, ends_at)
          values (${inst.institutionId}, 1, 'Period 1', '09:00', '09:40')
          returning id
        `;
        const [periodSession] = await sql`
          insert into public.attendance_sessions (institution_id, class_section_id, date, period_id, status)
          values (${inst.institutionId}, ${base.sectionId}::uuid, ${day}, ${period.id}::uuid, 'open')
          returning id
        `;

        const leave = await inst.clientAs("guardian").from("student_leave_requests").insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: day,
          end_date: day,
          reason: "Period day",
        }).select("id").single();

        const approve = await inst.clientAs("admin").rpc("decide_student_leave", { p_leave_id: leave.data!.id, p_decision: "approved" });
        expect(approve.error).toBeNull();

        const periodRecords = await sql`select count(*) from public.attendance_records where session_id = ${periodSession.id}::uuid`;
        expect(Number(periodRecords[0].count)).toBe(0);

        const [dailySession] = await sql`select id from public.attendance_sessions where class_section_id = ${base.sectionId}::uuid and date = ${day} and period_id is null`;
        expect(dailySession).toBeDefined();
        const [dailyRecord] = await sql`select status from public.attendance_records where session_id = ${dailySession.id}::uuid and student_id = ${base.studentId}::uuid`;
        expect(dailyRecord.status).toBe("OL");
      } finally {
        await inst.cleanup();
      }
    }, 20_000);

    it("OL removed from settings -> approve succeeds, nothing marked", async () => {
      const inst = await createTestInstitution("sl-premark-no-ol");
      try {
        const base = await makeBase(inst);
        await setAttendanceStatuses(inst.institutionId, ATTENDANCE_STATUSES_NO_OL);
        const day = isoDate(safeOffset(8));

        const leave = await inst.clientAs("guardian").from("student_leave_requests").insert({
          institution_id: inst.institutionId,
          student_id: base.studentId,
          class_section_id: crypto.randomUUID(),
          start_date: day,
          end_date: day,
          reason: "No OL configured",
        }).select("id").single();

        const approve = await inst.clientAs("admin").rpc("decide_student_leave", { p_leave_id: leave.data!.id, p_decision: "approved" });
        expect(approve.error).toBeNull();
        expect(approve.data.status).toBe("approved");

        const sessions = await sql`select count(*) from public.attendance_sessions where class_section_id = ${base.sectionId}::uuid and date = ${day}`;
        expect(Number(sessions[0].count)).toBe(0);
      } finally {
        await inst.cleanup();
      }
    }, 20_000);
  });
});
