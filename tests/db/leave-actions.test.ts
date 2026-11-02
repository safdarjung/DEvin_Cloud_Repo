import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (academics-setup-actions.test.ts pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { approveLeave, cancelLeave, rejectLeave, requestLeave } from "@/modules/people/leave.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M08-T8 — people.leave.request / people.leave.approve / people.leave.reject
// / people.leave.cancel (M08-tasks.md Task 8 rulings; migration 0070 part 1's
// leave_requests + decide_leave, built in T2).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships
    where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

describe("people.leave.* actions (M08-T8)", () => {
  it("teacher requests own leave -> pending", async () => {
    const inst = await createTestInstitution("leave-act-request");
    try {
      const result = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
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

  it("overlapping leave request -> conflict", async () => {
    const inst = await createTestInstitution("leave-act-overlap");
    try {
      const first = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
        startDate: isoDate(10),
        endDate: isoDate(12),
        reason: "First",
      });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "teacher", requestLeave, {
        leaveType: "sick",
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

  it("principal approves a teacher's leave -> approved and audited", async () => {
    const inst = await createTestInstitution("leave-act-approve");
    try {
      const requested = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
        startDate: isoDate(20),
        endDate: isoDate(21),
        reason: "Secret reason",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const approved = await callAs(inst, "principal", approveLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.data.status).toBe("approved");

      const auditRows = await sql`
        select action, after from public.audit_events
        where entity_id = ${requested.data.id}::uuid and action = 'leave.approved'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].after).toEqual({ status: "approved" });
    } finally {
      await inst.cleanup();
    }
  });

  it("principal approving own leave -> forbidden", async () => {
    const inst = await createTestInstitution("leave-act-own-approve");
    try {
      const principalStaffId = await staffIdFor(inst.institutionId, "principal");
      const requested = await callAs(inst, "principal", requestLeave, {
        staffId: principalStaffId,
        leaveType: "earned",
        startDate: isoDate(30),
        endDate: isoDate(31),
        reason: "Own leave",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const approved = await callAs(inst, "principal", approveLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(false);
      if (approved.ok) return;
      expect(approved.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling approve -> forbidden", async () => {
    const inst = await createTestInstitution("leave-act-teacher-approve");
    try {
      const requested = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
        startDate: isoDate(40),
        endDate: isoDate(41),
        reason: "Teacher self-approve attempt",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const approved = await callAs(inst, "teacher", approveLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(false);
      if (approved.ok) return;
      expect(approved.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher requesting leave for another staff member -> forbidden", async () => {
    const inst = await createTestInstitution("leave-act-other-staff");
    try {
      const principalStaffId = await staffIdFor(inst.institutionId, "principal");
      const result = await callAs(inst, "teacher", requestLeave, {
        staffId: principalStaffId,
        leaveType: "casual",
        startDate: isoDate(5),
        endDate: isoDate(6),
        reason: "Not mine",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("reject then approve -> invalid_state", async () => {
    const inst = await createTestInstitution("leave-act-reject-approve");
    try {
      const requested = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
        startDate: isoDate(50),
        endDate: isoDate(51),
        reason: "Reject me",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const rejected = await callAs(inst, "principal", rejectLeave, { leaveId: requested.data.id });
      expect(rejected.ok).toBe(true);
      if (!rejected.ok) return;
      expect(rejected.data.status).toBe("rejected");

      const approved = await callAs(inst, "principal", approveLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(false);
      if (approved.ok) return;
      expect(approved.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("requester cancels own pending leave -> cancelled", async () => {
    const inst = await createTestInstitution("leave-act-cancel");
    try {
      const requested = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
        startDate: isoDate(60),
        endDate: isoDate(61),
        reason: "Changed my mind",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const cancelled = await callAs(inst, "teacher", cancelLeave, { leaveId: requested.data.id });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.data.status).toBe("cancelled");
    } finally {
      await inst.cleanup();
    }
  });

  it("approver cancels an approved leave -> cancelled", async () => {
    const inst = await createTestInstitution("leave-act-cancel-approved");
    try {
      const requested = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
        startDate: isoDate(70),
        endDate: isoDate(71),
        reason: "Plans changed after approval",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const approved = await callAs(inst, "principal", approveLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      const cancelled = await callAs(inst, "principal", cancelLeave, { leaveId: requested.data.id });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.data.status).toBe("cancelled");
    } finally {
      await inst.cleanup();
    }
  });

  it("requester cannot cancel their own approved leave -> forbidden", async () => {
    const inst = await createTestInstitution("leave-act-cancel-own-approved");
    try {
      const requested = await callAs(inst, "teacher", requestLeave, {
        leaveType: "casual",
        startDate: isoDate(80),
        endDate: isoDate(81),
        reason: "Cannot self-cancel once approved",
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const approved = await callAs(inst, "principal", approveLeave, { leaveId: requested.data.id });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      const cancelled = await callAs(inst, "teacher", cancelLeave, { leaveId: requested.data.id });
      expect(cancelled.ok).toBe(false);
      if (cancelled.ok) return;
      expect(cancelled.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
