import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships
    where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

async function createBareStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Staff', 'teacher')
    returning id
  `;
  return row.id as string;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

describe("staffing migration (0070 part 1) — leave_requests + staff_attendance RLS", () => {
  it("teacher inserts own leave -> pending, created_by self even when spoofed", async () => {
    const inst = await createTestInstitution("leave-own");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      const otherUser = inst.users.admin.id; // spoofed created_by target

      const { data, error } = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: teacherStaffId,
          leave_type: "casual",
          start_date: isoDate(5),
          end_date: isoDate(6),
          reason: "Family function",
          status: "approved", // spoofed
          created_by: otherUser, // spoofed
        })
        .select("status, created_by")
        .single();

      expect(error).toBeNull();
      expect(data?.status).toBe("pending");
      expect(data?.created_by).toBe(inst.users.teacher.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher inserts leave for another staff member -> 42501", async () => {
    const inst = await createTestInstitution("leave-other-staff");
    try {
      const otherStaffId = await createBareStaff(inst.institutionId);

      const { error } = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: otherStaffId,
          leave_type: "casual",
          start_date: isoDate(5),
          end_date: isoDate(6),
          reason: "Not mine",
        });

      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("overlapping pending leave for the same staff -> conflict", async () => {
    const inst = await createTestInstitution("leave-overlap");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const first = await inst.clientAs("teacher").from("leave_requests").insert({
        institution_id: inst.institutionId,
        staff_id: teacherStaffId,
        leave_type: "casual",
        start_date: isoDate(10),
        end_date: isoDate(12),
        reason: "First",
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("teacher").from("leave_requests").insert({
        institution_id: inst.institutionId,
        staff_id: teacherStaffId,
        leave_type: "sick",
        start_date: isoDate(11),
        end_date: isoDate(13),
        reason: "Overlaps first",
      });
      expect(second.error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("principal approves teacher's leave -> approved + audit_events row without the reason", async () => {
    const inst = await createTestInstitution("leave-approve");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const inserted = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: teacherStaffId,
          leave_type: "casual",
          start_date: isoDate(20),
          end_date: isoDate(21),
          reason: "Secret reason text",
        })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      const leaveId = inserted.data!.id as string;

      const approve = await inst.clientAs("principal").rpc("decide_leave", {
        p_leave_id: leaveId,
        p_decision: "approved",
      });
      expect(approve.error).toBeNull();
      expect(approve.data.status).toBe("approved");

      const [audit] = await sql`
        select metadata, before, after from public.audit_events
        where entity_id = ${leaveId}::uuid and action = 'leave.approved'
      `;
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit.before)).not.toContain("Secret reason text");
      expect(JSON.stringify(audit.after)).not.toContain("Secret reason text");
      expect(audit.after).toEqual({ status: "approved" });
    } finally {
      await inst.cleanup();
    }
  });

  it("principal approving own leave -> forbidden", async () => {
    const inst = await createTestInstitution("leave-own-approve");
    try {
      const principalStaffId = await staffIdFor(inst.institutionId, "principal");

      const inserted = await inst
        .clientAs("principal")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: principalStaffId,
          leave_type: "earned",
          start_date: isoDate(30),
          end_date: isoDate(31),
          reason: "Own leave",
        })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();

      const approve = await inst.clientAs("principal").rpc("decide_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "approved",
      });
      expect(approve.error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling decide_leave to approve -> forbidden", async () => {
    const inst = await createTestInstitution("leave-teacher-decide");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const inserted = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: teacherStaffId,
          leave_type: "casual",
          start_date: isoDate(40),
          end_date: isoDate(41),
          reason: "Teacher self-approve attempt",
        })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();

      const approve = await inst.clientAs("teacher").rpc("decide_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "approved",
      });
      expect(approve.error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("approving an already-approved leave -> invalid_state", async () => {
    const inst = await createTestInstitution("leave-double-approve");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const inserted = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: teacherStaffId,
          leave_type: "casual",
          start_date: isoDate(50),
          end_date: isoDate(51),
          reason: "Double approve",
        })
        .select("id")
        .single();
      const leaveId = inserted.data!.id as string;

      const first = await inst.clientAs("principal").rpc("decide_leave", { p_leave_id: leaveId, p_decision: "approved" });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("principal").rpc("decide_leave", { p_leave_id: leaveId, p_decision: "approved" });
      expect(second.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("requester cancels own pending leave -> cancelled", async () => {
    const inst = await createTestInstitution("leave-cancel");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const inserted = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: teacherStaffId,
          leave_type: "casual",
          start_date: isoDate(60),
          end_date: isoDate(61),
          reason: "Changed my mind",
        })
        .select("id")
        .single();

      const cancel = await inst.clientAs("teacher").rpc("decide_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "cancelled",
      });
      expect(cancel.error).toBeNull();
      expect(cancel.data.status).toBe("cancelled");
    } finally {
      await inst.cleanup();
    }
  });

  it("direct UPDATE of leave_requests.status outside the RPC is denied", async () => {
    const inst = await createTestInstitution("leave-direct-update");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const inserted = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: teacherStaffId,
          leave_type: "casual",
          start_date: isoDate(70),
          end_date: isoDate(71),
          reason: "Direct update attempt",
        })
        .select("id")
        .single();
      const leaveId = inserted.data!.id as string;

      const update = await inst
        .clientAs("principal")
        .from("leave_requests")
        .update({ status: "approved" })
        .eq("id", leaveId)
        .select("id");

      expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);

      const [row] = await sql`select status from public.leave_requests where id = ${leaveId}::uuid`;
      expect(row.status).toBe("pending");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin marks staff_attendance for own-institution staff, not another institution's", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const teacherA = await staffIdFor(a.institutionId, "teacher");
      const teacherB = await staffIdFor(b.institutionId, "teacher");

      const ownMark = await a.clientAs("admin").from("staff_attendance").insert({
        institution_id: a.institutionId,
        staff_id: teacherA,
        date: isoDate(0),
        status: "present",
      });
      expect(ownMark.error).toBeNull();

      const crossMark = await a.clientAs("admin").from("staff_attendance").insert({
        institution_id: a.institutionId,
        staff_id: teacherB,
        date: isoDate(0),
        status: "present",
      });
      expect(crossMark.error).not.toBeNull();
    });
  });

  it("teacher sees only own staff_attendance + leave rows; accountant and guardian see none", async () => {
    const inst = await createTestInstitution("leave-attendance-scope");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const mark = await inst.clientAs("admin").from("staff_attendance").insert({
        institution_id: inst.institutionId,
        staff_id: teacherStaffId,
        date: isoDate(0),
        status: "present",
      });
      expect(mark.error).toBeNull();

      const leave = await inst.clientAs("teacher").from("leave_requests").insert({
        institution_id: inst.institutionId,
        staff_id: teacherStaffId,
        leave_type: "casual",
        start_date: isoDate(80),
        end_date: isoDate(81),
        reason: "Scope check",
      });
      expect(leave.error).toBeNull();

      const teacherAttendance = await inst.clientAs("teacher").from("staff_attendance").select("id");
      expect(teacherAttendance.data).toHaveLength(1);
      const teacherLeave = await inst.clientAs("teacher").from("leave_requests").select("id");
      expect(teacherLeave.data).toHaveLength(1);

      const accountantAttendance = await inst.clientAs("accountant").from("staff_attendance").select("id");
      expect(accountantAttendance.data).toHaveLength(0);
      const accountantLeave = await inst.clientAs("accountant").from("leave_requests").select("id");
      expect(accountantLeave.data).toHaveLength(0);

      const guardianAttendance = await inst.clientAs("guardian").from("staff_attendance").select("id");
      expect(guardianAttendance.data).toHaveLength(0);
      const guardianLeave = await inst.clientAs("guardian").from("leave_requests").select("id");
      expect(guardianLeave.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("staff_check_in twice returns the same row", async () => {
    const inst = await createTestInstitution("checkin-twice");
    try {
      const first = await inst.clientAs("teacher").rpc("staff_check_in", { p_institution_id: inst.institutionId });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("teacher").rpc("staff_check_in", { p_institution_id: inst.institutionId });
      expect(second.error).toBeNull();

      expect(second.data.id).toBe(first.data.id);
      expect(second.data.check_in_at).toBe(first.data.check_in_at);

      const rows = await sql`select count(*) from public.staff_attendance where staff_id = ${first.data.staff_id}::uuid`;
      expect(Number(rows[0].count)).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("staff_check_in while on approved leave today -> invalid_state", async () => {
    const inst = await createTestInstitution("checkin-on-leave");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const inserted = await inst
        .clientAs("teacher")
        .from("leave_requests")
        .insert({
          institution_id: inst.institutionId,
          staff_id: teacherStaffId,
          leave_type: "sick",
          start_date: isoDate(0),
          end_date: isoDate(1),
          reason: "Sick today",
        })
        .select("id")
        .single();

      const approve = await inst.clientAs("principal").rpc("decide_leave", {
        p_leave_id: inserted.data!.id,
        p_decision: "approved",
      });
      expect(approve.error).toBeNull();

      const checkIn = await inst.clientAs("teacher").rpc("staff_check_in", { p_institution_id: inst.institutionId });
      expect(checkIn.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("student calling staff_check_in -> forbidden", async () => {
    const inst = await createTestInstitution("checkin-student");
    try {
      const checkIn = await inst.clientAs("student").rpc("staff_check_in", { p_institution_id: inst.institutionId });
      expect(checkIn.error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
