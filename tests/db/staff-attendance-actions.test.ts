import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 pattern) — only this file's module graph gets them.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { checkIn, markStaffAttendance } from "@/modules/people/staff-attendance.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function isoDateOffset(offsetDays: number): string {
  const d = new Date(`${todayIso()}T00:00:00Z`);
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

async function createBareStaff(inst: TestInstitution, label: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${label}, 'teacher')
    returning id
  `;
  return row.id as string;
}

async function insertApprovedLeave(inst: TestInstitution, staffId: string, startDate: string, endDate: string): Promise<void> {
  const principalUserId = inst.users.principal.id;
  await sql`
    insert into public.leave_requests
      (institution_id, staff_id, leave_type, start_date, end_date, reason, status, created_by, decided_by, decided_at)
    values
      (${inst.institutionId}, ${staffId}, 'sick', ${startDate}, ${endDate}, 'Fixture leave', 'approved', ${principalUserId}, ${principalUserId}, now())
  `;
}

describe("M08-T7 — people.staffAttendance.mark/checkIn", () => {
  it("principal marks 3 staff -> rows, and re-marking updates status", async () => {
    const inst = await createTestInstitution("staff-att-mark");
    try {
      const a = await createBareStaff(inst, "Staff A");
      const b = await createBareStaff(inst, "Staff B");
      const c = await createBareStaff(inst, "Staff C");
      const date = todayIso();

      const result = await callAs(inst, "principal", markStaffAttendance, {
        date,
        records: [
          { staffId: a, status: "present" },
          { staffId: b, status: "late" },
          { staffId: c, status: "absent" },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.count).toBe(3);

      const rows = await sql`select staff_id, status from public.staff_attendance where institution_id = ${inst.institutionId} and date = ${date}`;
      expect(rows.length).toBe(3);

      const remark = await callAs(inst, "principal", markStaffAttendance, {
        date,
        records: [{ staffId: a, status: "half_day", note: "corrected" }],
      });
      expect(remark.ok).toBe(true);

      const [updated] = await sql`select status, note from public.staff_attendance where institution_id = ${inst.institutionId} and staff_id = ${a} and date = ${date}`;
      expect(updated.status).toBe("half_day");
      expect(updated.note).toBe("corrected");

      const stillThree = await sql`select count(*)::int as n from public.staff_attendance where institution_id = ${inst.institutionId} and date = ${date}`;
      expect(stillThree[0].n).toBe(3);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calls mark -> forbidden", async () => {
    const inst = await createTestInstitution("staff-att-teacher-forbidden");
    try {
      const target = await staffIdFor(inst.institutionId, "teacher");
      const result = await callAs(inst, "teacher", markStaffAttendance, {
        date: todayIso(),
        records: [{ staffId: target, status: "present" }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian calls mark -> forbidden", async () => {
    const inst = await createTestInstitution("staff-att-guardian-forbidden");
    try {
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      const result = await callAs(inst, "guardian", markStaffAttendance, {
        date: todayIso(),
        records: [{ staffId: teacherStaffId, status: "present" }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("marking a staff member on approved leave that date -> invalid_state naming the index", async () => {
    const inst = await createTestInstitution("staff-att-on-leave");
    try {
      const onLeaveStaff = await createBareStaff(inst, "On Leave Staff");
      const okStaff = await createBareStaff(inst, "OK Staff");
      const date = todayIso();
      await insertApprovedLeave(inst, onLeaveStaff, isoDateOffset(-1), isoDateOffset(1));

      const result = await callAs(inst, "principal", markStaffAttendance, {
        date,
        records: [
          { staffId: okStaff, status: "present" },
          { staffId: onLeaveStaff, status: "present" },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
      expect(result.error.fieldErrors?.records?.[0]).toBe("1: on approved leave");

      const rows = await sql`select 1 from public.staff_attendance where institution_id = ${inst.institutionId} and date = ${date}`;
      expect(rows.length).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher checkIn twice -> one row, idempotent", async () => {
    const inst = await createTestInstitution("staff-att-checkin");
    try {
      const first = await callAs(inst, "teacher", checkIn, {});
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.status).toBe("present");
      expect(first.data.source).toBe("self");

      const second = await callAs(inst, "teacher", checkIn, {});
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.id).toBe(first.data.id);

      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      const rows = await sql`select 1 from public.staff_attendance where institution_id = ${inst.institutionId} and staff_id = ${teacherStaffId} and date = ${todayIso()}`;
      expect(rows.length).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian calls checkIn -> forbidden", async () => {
    const inst = await createTestInstitution("staff-att-checkin-guardian");
    try {
      const result = await callAs(inst, "guardian", checkIn, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
