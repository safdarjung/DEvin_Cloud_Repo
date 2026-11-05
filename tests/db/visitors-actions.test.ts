import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { checkInVisitor, checkOutVisitor, purgeVisitors } from "@/modules/visitors/actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// X07-T4 — visitors.checkIn / visitors.checkOut / visitors.purge (X07-tasks.md
// Task 4 TEST FIRST list). State machine (double check-out) and retention
// delete are 0090's (guard_visitor_entries, visitor_entries_delete RLS).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("visitors actions (X07-T4)", () => {
  it("admin checks in with masked ID, checks out, second check-out is invalid_state; unknown id is not_found", async () => {
    const inst = await createTestInstitution("visitors-actions-happy");

    const checkedIn = await callAs(inst, "admin", checkInVisitor, {
      fullName: "Probe Visitor",
      phone: "9876543210",
      purpose: "Fee enquiry",
      meetingWith: "Office",
      idType: "aadhaar",
      idLast4: "ab12",
    });
    expect(checkedIn.ok).toBe(true);
    if (!checkedIn.ok) return;

    const [row] = await sql`select id_type, id_last4, checked_out_at from public.visitor_entries where id = ${checkedIn.data.id}`;
    expect(row.id_type).toBe("aadhaar");
    expect(row.id_last4).toBe("AB12");
    expect(row.checked_out_at).toBeNull();

    const checkedOut = await callAs(inst, "admin", checkOutVisitor, { id: checkedIn.data.id });
    expect(checkedOut.ok).toBe(true);
    if (!checkedOut.ok) return;
    expect(checkedOut.data.checkedOutAt).not.toBeNull();

    const secondCheckOut = await callAs(inst, "admin", checkOutVisitor, { id: checkedIn.data.id });
    expect(secondCheckOut.ok).toBe(false);
    if (!secondCheckOut.ok) expect(secondCheckOut.error.code).toBe("invalid_state");

    const unknown = await callAs(inst, "admin", checkOutVisitor, { id: crypto.randomUUID() });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("not_found");

    const [auditRow] = await sql`
      select before, after, metadata from public.audit_events
      where action = 'visitors.check_in' and entity_id = ${checkedIn.data.id}
    `;
    const auditJson = JSON.stringify([auditRow.before, auditRow.after, auditRow.metadata]);
    expect(auditJson).not.toContain("9876543210");
    expect(auditJson).not.toContain("Probe Visitor");

    await inst.cleanup();
  });

  it("hostStaffId from another institution -> forbidden; teacher -> forbidden", async () => {
    // Two full fixture institutions (9 roles each) under concurrent lane load
    // can exceed vitest's 5s default — same relief as other cross-institution
    // db tests that see this under load.
    const instA = await createTestInstitution("visitors-actions-cross-a");
    const instB = await createTestInstitution("visitors-actions-cross-b");

    const ctxB = await buildContext(instB, "admin");
    const crossHost = await callAs(instA, "admin", checkInVisitor, {
      fullName: "Probe Visitor",
      phone: "9876543210",
      purpose: "Vendor delivery",
      hostStaffId: ctxB.membership.staffId as string,
    });
    expect(crossHost.ok).toBe(false);
    if (!crossHost.ok) expect(crossHost.error.code).toBe("forbidden");

    const teacherAttempt = await callAs(instA, "teacher", checkInVisitor, {
      fullName: "Probe Visitor",
      phone: "9876543210",
      purpose: "PTM",
      meetingWith: "Office",
    });
    expect(teacherAttempt.ok).toBe(false);
    if (!teacherAttempt.ok) expect(teacherAttempt.error.code).toBe("forbidden");

    await instA.cleanup();
    await instB.cleanup();
  }, 20000);

  it("purge deletes a 200-day-old entry and keeps a 10-day-old one", async () => {
    const inst = await createTestInstitution("visitors-actions-purge");
    const adminUserId = inst.users.admin.id;

    const [oldRow] = await sql`
      insert into public.visitor_entries (institution_id, full_name, phone, purpose, meeting_with, checked_in_by, checked_in_at)
      values (${inst.institutionId}, 'Old Visitor', '9876543210', 'Probe', 'Office', ${adminUserId}, now() - interval '200 days')
      returning id
    `;
    const [recentRow] = await sql`
      insert into public.visitor_entries (institution_id, full_name, phone, purpose, meeting_with, checked_in_by, checked_in_at)
      values (${inst.institutionId}, 'Recent Visitor', '9876543210', 'Probe', 'Office', ${adminUserId}, now() - interval '10 days')
      returning id
    `;

    const purged = await callAs(inst, "admin", purgeVisitors, {});
    expect(purged.ok).toBe(true);
    if (!purged.ok) return;
    expect(purged.data.deleted).toBe(1);

    const remaining = await sql`select id from public.visitor_entries where institution_id = ${inst.institutionId}`;
    expect(remaining.map((r) => r.id)).toEqual([recentRow.id]);
    expect(remaining.map((r) => r.id)).not.toContain(oldRow.id);

    await inst.cleanup();
  });
});
