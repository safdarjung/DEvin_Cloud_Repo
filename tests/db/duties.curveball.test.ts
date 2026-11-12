// Curveball sweep (duties): updateDutyType, setDutyAssignment and cancelDutySwap at the action layer, plus swap misuse.
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { cancelDutySwap, createDutyType, requestDutySwap, respondDutySwap, setDutyAssignment, updateDutyType } from "@/modules/duties/actions";
import { addDays } from "@/modules/duties/dates";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 4 });
const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
let inst: TestInstitution;
let other: TestInstitution;
let typeId: string;
let me: string; // fixture teacher's staff id
let colleague: string;
let colleague2: string;
let foreignStaff: string;
let offset = 30;
const extraUsers: string[] = [];
const adminApi = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);

/** A teaching staff member with a real teacher membership (swap targets must be able to respond). */
async function memberTeacher(name: string): Promise<string> {
  const id = await staff(inst, name);
  const { data, error } = await adminApi().auth.admin.createUser({
    email: `test-duty-cb-${crypto.randomUUID()}@test.coolskool.test`,
    password: "correct-horse-battery-staple",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user");
  extraUsers.push(data.user.id);
  await sql`insert into public.memberships (institution_id, user_id, role, staff_id) values (${inst.institutionId}, ${data.user.id}, 'teacher', ${id})`;
  return id;
}

async function staff(i: TestInstitution, name: string): Promise<string> {
  const [s] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${i.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${name}, 'teacher', true) returning id`;
  return s.id as string;
}
async function assignment(staffId: string, day = addDays(today, offset++)): Promise<string> {
  const [a] = await sql`insert into public.duty_assignments (institution_id, duty_type_id, staff_id, date) values (${inst.institutionId}, ${typeId}, ${staffId}, ${day}) returning id`;
  return a.id as string;
}

beforeAll(async () => {
  inst = await createTestInstitution("duty-cb");
  other = await createTestInstitution("duty-cb-x");
  const [m] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
  me = m.staff_id as string;
  await sql`update public.staff set is_teaching = true where id = ${me}`;
  colleague = await memberTeacher("Colleague");
  colleague2 = await memberTeacher("Colleague Two");
  foreignStaff = await staff(other, "Elsewhere");
  const t = await callAs(inst, "admin", createDutyType, { name: "Bus", slotsPerDay: 2 });
  if (!t.ok) throw new Error("type fixture");
  typeId = t.data.id;
}, 60_000);

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await Promise.all(extraUsers.map((u) => adminApi().auth.admin.deleteUser(u)));
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("updateDutyType", () => {
  it("slotsPerDay 0 / 21 / 1.5 and blank name → validation_failed with fieldErrors", async () => {
    for (const slotsPerDay of [0, 21, 1.5]) {
      const r = await callAs(inst, "admin", updateDutyType, { id: typeId, name: "Bus", slotsPerDay, isActive: true });
      expect(r.ok ? null : r.error.fieldErrors?.slotsPerDay).toBeTruthy();
    }
    const blank = await callAs(inst, "admin", updateDutyType, { id: typeId, name: "  ", slotsPerDay: 1, isActive: true });
    expect(blank.ok ? null : blank.error.fieldErrors?.name).toBeTruthy();
  });

  it("another school's type and an unknown id → not_found; teacher → forbidden", async () => {
    const theirs = await callAs(other, "admin", createDutyType, { name: "Gate", slotsPerDay: 1 });
    if (!theirs.ok) throw new Error(theirs.error.code);
    const cross = await callAs(inst, "admin", updateDutyType, { id: theirs.data.id, name: "Mine", slotsPerDay: 1, isActive: false });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
    const unknown = await callAs(inst, "admin", updateDutyType, { id: crypto.randomUUID(), name: "X", slotsPerDay: 1, isActive: true });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const t = await callAs(inst, "teacher", updateDutyType, { id: typeId, name: "X", slotsPerDay: 1, isActive: true });
    expect(t.ok ? null : t.error.code).toBe("forbidden");
  });

  it("a duplicate type name → conflict", async () => {
    const r = await callAs(inst, "admin", createDutyType, { name: "Bus", slotsPerDay: 1 });
    expect(r.ok ? null : r.error.code).toBe("conflict");
  });
});

describe("setDutyAssignment", () => {
  it("both staffId and cancel, or neither → validation_failed on staffId", async () => {
    const id = await assignment(me);
    const both = await callAs(inst, "admin", setDutyAssignment, { assignmentId: id, staffId: colleague, cancel: true });
    expect(both.ok ? null : both.error.fieldErrors?.staffId).toBeTruthy();
    const neither = await callAs(inst, "admin", setDutyAssignment, { assignmentId: id });
    expect(neither.ok ? null : neither.error.fieldErrors?.staffId).toBeTruthy();
  });

  it("reassigning to someone already on that duty that day → conflict, assignment unchanged", async () => {
    const day = addDays(today, offset++);
    const id = await assignment(me, day);
    await assignment(colleague, day);
    const r = await callAs(inst, "admin", setDutyAssignment, { assignmentId: id, staffId: colleague });
    expect(r.ok ? null : r.error.code).toBe("conflict");
    const [row] = await sql`select staff_id from public.duty_assignments where id = ${id}`;
    expect(row.staff_id).toBe(me);
  });

  it("another school's staff member is refused; an unknown assignment → not_found; teacher forbidden", async () => {
    const id = await assignment(me);
    const foreign = await callAs(inst, "admin", setDutyAssignment, { assignmentId: id, staffId: foreignStaff });
    expect(foreign.ok).toBe(false);
    expect(foreign.ok ? null : foreign.error.code).not.toBe("internal");
    const [row] = await sql`select staff_id from public.duty_assignments where id = ${id}`;
    expect(row.staff_id).toBe(me);
    const unknown = await callAs(inst, "admin", setDutyAssignment, { assignmentId: crypto.randomUUID(), cancel: true });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const t = await callAs(inst, "teacher", setDutyAssignment, { assignmentId: id, cancel: true });
    expect(t.ok ? null : t.error.code).toBe("forbidden");
  });

  it("cancelling twice: second is refused (invalid_state); a cancelled duty cannot be reassigned", async () => {
    const id = await assignment(me);
    expect((await callAs(inst, "admin", setDutyAssignment, { assignmentId: id, cancel: true })).ok).toBe(true);
    const again = await callAs(inst, "admin", setDutyAssignment, { assignmentId: id, cancel: true });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
    const reassign = await callAs(inst, "admin", setDutyAssignment, { assignmentId: id, staffId: colleague });
    expect(reassign.ok ? null : reassign.error.code).toBe("invalid_state");
  });
});

describe("swap misuse", () => {
  it("a second open swap for the same duty → conflict", async () => {
    const id = await assignment(me);
    expect((await callAs(inst, "teacher", requestDutySwap, { assignmentId: id, toStaffId: colleague })).ok).toBe(true);
    const dup = await callAs(inst, "teacher", requestDutySwap, { assignmentId: id, toStaffId: colleague2 });
    expect(dup.ok ? null : dup.error.code).toBe("conflict");
  });

  it("a teacher cannot request a swap of someone else's duty, or swap to themselves", async () => {
    const theirs = await assignment(colleague);
    const r = await callAs(inst, "teacher", requestDutySwap, { assignmentId: theirs, toStaffId: colleague2 });
    expect(r.ok).toBe(false);
    const mine = await assignment(me);
    const self = await callAs(inst, "teacher", requestDutySwap, { assignmentId: mine, toStaffId: me });
    expect(self.ok).toBe(false);
    expect([r, self].map((x) => (x.ok ? "ok" : x.error.code))).not.toContain("internal");
  });

  it("cancel twice → invalid_state; respond to a cancelled request → refused; unknown request → not_found", async () => {
    const id = await assignment(me);
    const req = await callAs(inst, "teacher", requestDutySwap, { assignmentId: id, toStaffId: colleague });
    if (!req.ok) throw new Error(req.error.code);
    expect((await callAs(inst, "teacher", cancelDutySwap, { requestId: req.data.requestId })).ok).toBe(true);
    const again = await callAs(inst, "teacher", cancelDutySwap, { requestId: req.data.requestId });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
    const respond = await callAs(inst, "teacher", respondDutySwap, { requestId: req.data.requestId, accept: true });
    expect(respond.ok).toBe(false);
    const unknown = await callAs(inst, "teacher", cancelDutySwap, { requestId: crypto.randomUUID() });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const [row] = await sql`select staff_id from public.duty_assignments where id = ${id}`;
    expect(row.staff_id).toBe(me);
  });

  it("admin cannot use the teacher-only swap actions (duty.swap)", async () => {
    const r = await callAs(inst, "admin", cancelDutySwap, { requestId: crypto.randomUUID() });
    expect(r.ok ? null : r.error.code).toBe("forbidden");
  });
});
