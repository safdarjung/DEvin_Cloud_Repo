// M08-T11 — HR queries: demoStaffAvailability/demoApprovals fixture
// replacement (staffAvailabilityToday/pendingLeaveApprovals) + leaveRequests/
// staffAttendanceForDate RLS-scoping. Mirrors tests/db/staff-leave-rls.test.ts
// fixture style (isoDate, staffIdFor) and tests/helpers/actions.ts's callAs
// for permission-gated calls through the registered hr.query-defs.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { leaveRequestsQuery, pendingLeaveApprovalsQuery, staffAttendanceForDateQuery, staffAvailabilityTodayQuery } from "@/modules/people/hr.query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships
    where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

async function insertLeave(inst: TestInstitution, role: "teacher" | "admin", staffId: string, startDate: string, endDate: string): Promise<string> {
  const { data, error } = await inst
    .clientAs(role)
    .from("leave_requests")
    .insert({
      institution_id: inst.institutionId,
      staff_id: staffId,
      leave_type: "casual",
      start_date: startDate,
      end_date: endDate,
      reason: "test fixture",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

describe("hr queries (M08-T11)", () => {
  it("staffAvailabilityToday: 1 on leave until today -> Back tomorrow", async () => {
    const inst = await createTestInstitution("hr-availability");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      const today = isoDate(0);
      const leaveId = await insertLeave(inst, "teacher", teacherStaffId, today, today);
      const approve = await inst.clientAs("principal").rpc("decide_leave", { p_leave_id: leaveId, p_decision: "approved" });
      expect(approve.error).toBeNull();

      const result = await callAs(inst, "owner", staffAvailabilityTodayQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.onLeave).toBe(1);
      expect(result.data.onLeaveStaff).toHaveLength(1);
      expect(result.data.onLeaveStaff[0].until).toBe("Back tomorrow");
      expect(result.data.onLeaveStaff[0].name).toBe("Test teacher");
    } finally {
      await inst.cleanup();
    }
  });

  it('pendingLeaveApprovals: title formats as "Casual leave, 2 days"', async () => {
    const inst = await createTestInstitution("hr-pending-title");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      await insertLeave(inst, "teacher", teacherStaffId, isoDate(5), isoDate(6));

      const result = await callAs(inst, "principal", pendingLeaveApprovalsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toBe("Casual leave, 2 days");
      expect(result.data[0].requestedBy).toBe("Test teacher");
      expect(result.data[0].kind).toBe("leave");
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant calling pendingLeaveApprovals -> forbidden", async () => {
    const inst = await createTestInstitution("hr-pending-forbidden");
    try {
      const result = await callAs(inst, "accountant", pendingLeaveApprovalsQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher's leaveRequests returns only own rows", async () => {
    const inst = await createTestInstitution("hr-leave-own");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      const adminStaffId = await staffIdFor(inst.institutionId, "admin");
      await insertLeave(inst, "teacher", teacherStaffId, isoDate(2), isoDate(3));
      await insertLeave(inst, "admin", adminStaffId, isoDate(2), isoDate(3));

      const result = await callAs(inst, "teacher", leaveRequestsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].staffId).toBe(teacherStaffId);
    } finally {
      await inst.cleanup();
    }
  });

  it("staffAttendanceForDate for a teacher returns 1 row", async () => {
    const inst = await createTestInstitution("hr-attendance-own");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      const adminStaffId = await staffIdFor(inst.institutionId, "admin");
      // staff_select's own-row branch is `user_id = app.current_user_id()`;
      // createTestInstitution doesn't link it (mirrors documents-rls.test.ts).
      await sql`update public.staff set user_id = ${inst.users.teacher.id} where id = ${teacherStaffId}`;
      const today = isoDate(0);
      const mark = await inst.clientAs("principal").from("staff_attendance").insert([
        { institution_id: inst.institutionId, staff_id: teacherStaffId, date: today, status: "present", source: "admin" },
        { institution_id: inst.institutionId, staff_id: adminStaffId, date: today, status: "present", source: "admin" },
      ]);
      expect(mark.error).toBeNull();

      const result = await callAs(inst, "teacher", staffAttendanceForDateQuery, { date: today });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].staffId).toBe(teacherStaffId);
      expect(result.data[0].status).toBe("present");
      expect(result.data[0].onLeave).toBe(false);
    } finally {
      await inst.cleanup();
    }
  });
});
