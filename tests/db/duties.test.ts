// Features-18 #24 — duties: fair rotation, leave/holiday skips, idempotence, swaps, RLS.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createDutyType, generateDutyRoster, requestDutySwap, respondDutySwap } from "@/modules/duties/actions";
import { dutyCountByType, dutyRoster, dutyStaffOptions } from "@/modules/duties/queries";
import { addDays, weekStart } from "@/modules/duties/dates";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 4 });
const PASSWORD = "correct-horse-battery-staple";
let inst: TestInstitution;
let other: TestInstitution;
let typeId: string;
let staffA: string; // fixture teacher
let staffB: string; // second teacher (membership)
let staffC: string;
let staffD: string;
let clientB: SupabaseClient;
let userB: string;
const extraUsers: string[] = [];

const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const mondayAfter = (n: number) => weekStart(addDays(today, n)); // Monday of a future week (>= today when n >= 7)
const W1 = mondayAfter(14);
const W2 = mondayAfter(21);
const W3 = mondayAfter(28);

beforeAll(async () => {
  inst = await createTestInstitution("duty");
  other = await createTestInstitution("duty-x");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);

  const [a] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
  staffA = a!.staff_id;
  await sql`update public.staff set is_teaching = true where id = ${staffA}`;

  // Second teacher with a real login.
  const email = `test-duty-teacher2-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("teacher2");
  userB = data.user.id;
  extraUsers.push(userB);
  const [sb] = await sql`insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching) values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Teacher Two', 'teacher', true) returning id`;
  staffB = sb!.id;
  await sql`insert into public.memberships (institution_id, user_id, role, staff_id) values (${inst.institutionId}, ${userB}, 'teacher', ${staffB})`;
  clientB = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const si = await clientB.auth.signInWithPassword({ email, password: PASSWORD });
  if (si.error) throw si.error;

  for (const n of ["C", "D"]) {
    const [s] = await sql`insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching) values (${inst.institutionId}, ${`EMP-${n}-${crypto.randomUUID().slice(0, 6)}`}, ${`Teacher ${n}`}, 'teacher', true) returning id`;
    if (n === "C") staffC = s!.id;
    else staffD = s!.id;
  }

  const t = await callAs(inst, "admin", createDutyType, { name: "Gate", slotsPerDay: 1 });
  if (!t.ok) throw new Error("duty type fixture");
  typeId = t.data.id;

  // Recent history: A 3, B 2, C 1, D 0 duties in the last 60 days.
  const hist: [string, number][] = [[staffA, 3], [staffB, 2], [staffC, 1]];
  let d = 1;
  for (const [sid, n] of hist) for (let i = 0; i < n; i++) await sql`insert into public.duty_assignments (institution_id, duty_type_id, staff_id, date) values (${inst.institutionId}, ${typeId}, ${sid}, ${addDays(today, -(d++))})`;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
  await Promise.all(extraUsers.map((u) => admin.auth.admin.deleteUser(u)));
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const picks = async (from: string, to: string) =>
  (await sql`select date::text as d, staff_id from public.duty_assignments where institution_id = ${inst.institutionId} and date between ${from} and ${to} and status <> 'cancelled' order by date, staff_id`) as unknown as { d: string; staff_id: string }[];

describe("duties", () => {
  it("fair rotation: fewest recent duties first, ties by staff id, same picks on a repeat run", async () => {
    const days = [0, 1, 2, 3].map((i) => addDays(W1, i));
    const counts = new Map([[staffA, 3], [staffB, 2], [staffC, 1], [staffD, 0]]);
    const expected: string[] = [];
    for (let i = 0; i < days.length; i++) {
      const next = [...counts].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1))[0]![0];
      expected.push(next);
      counts.set(next, counts.get(next)! + 1);
    }
    const r = await callAs(inst, "admin", generateDutyRoster, { from: days[0]!, to: days[3]! });
    expect(r.ok && r.data.created).toBe(4);
    const first = await picks(days[0]!, days[3]!);
    expect(first.map((p) => p.staff_id)).toEqual(expected);
    expect(first[0]!.staff_id).toBe(staffD); // D had the fewest

    await sql`delete from public.duty_assignments where institution_id = ${inst.institutionId} and date between ${days[0]!} and ${days[3]!}`;
    expect((await callAs(inst, "admin", generateDutyRoster, { from: days[0]!, to: days[3]! })).ok).toBe(true);
    expect((await picks(days[0]!, days[3]!)).map((p) => p.staff_id)).toEqual(expected);
  });

  it("re-running the same range adds nothing", async () => {
    const r = await callAs(inst, "admin", generateDutyRoster, { from: W1, to: addDays(W1, 3) });
    expect(r.ok && r.data.created).toBe(0);
    expect(r.ok && r.data.skippedAlreadyRostered).toBe(4);
  });

  it("staff on approved leave and holidays are skipped", async () => {
    const [{ id: yearId }] = await sql`insert into public.academic_years (institution_id, name, starts_on, ends_on) values (${inst.institutionId}, 'duty-year', ${addDays(today, -100)}, ${addDays(today, 300)}) returning id`;
    await sql`insert into public.academic_calendar_events (institution_id, academic_year_id, kind, title, starts_on, ends_on, created_by) values (${inst.institutionId}, ${yearId}, 'holiday', 'Test holiday', ${addDays(W2, 1)}, ${addDays(W2, 1)}, ${inst.users.admin.id})`;
    // Everyone but D has more duties now; D is the natural pick on Monday of W2 unless on leave. Put every other staff on leave except D and check D skipped.
    await sql`insert into public.leave_requests (institution_id, staff_id, leave_type, start_date, end_date, reason, status, created_by) values (${inst.institutionId}, ${staffD}, 'casual', ${W2}, ${W2}, 'test', 'approved', ${inst.users.admin.id})`;
    await sql`insert into public.leave_requests (institution_id, staff_id, leave_type, start_date, end_date, reason, status, created_by) values (${inst.institutionId}, ${staffC}, 'casual', ${W2}, ${W2}, 'test', 'pending', ${inst.users.admin.id})`;
    const r = await callAs(inst, "admin", generateDutyRoster, { from: W2, to: addDays(W2, 2) });
    expect(r.ok && r.data.skippedHolidays).toBe(1);
    expect(r.ok && r.data.created).toBe(2);
    const rows = await picks(W2, addDays(W2, 2));
    expect(rows.map((p) => p.d)).toEqual([W2, addDays(W2, 2)]); // Tuesday is a holiday
    expect(rows[0]!.staff_id).not.toBe(staffD); // approved leave skipped
  });

  it("unfilled slots are counted when too few staff are free", async () => {
    const t = await callAs(inst, "admin", createDutyType, { name: "Lunch", slotsPerDay: 9 });
    expect(t.ok).toBe(true);
    const r = await callAs(inst, "admin", generateDutyRoster, { from: W3, to: W3 });
    expect(r.ok && r.data.unfilledSlots).toBe(5); // Gate 1/1 filled; Lunch 4 teaching staff for 9 slots
  });

  it("teacher cannot generate; past dates and long ranges are refused", async () => {
    expect((await callAs(inst, "teacher", generateDutyRoster, { from: W3, to: W3 })).ok).toBe(false);
    const rpc = await inst.clientAs("teacher").rpc("generate_duty_roster", { p_institution_id: inst.institutionId, p_from: W3, p_to: W3 });
    expect(rpc.error).not.toBeNull();
    const past = await inst.clientAs("admin").rpc("generate_duty_roster", { p_institution_id: inst.institutionId, p_from: addDays(today, -1), p_to: today });
    expect(past.error).not.toBeNull();
    const long = await inst.clientAs("admin").rpc("generate_duty_roster", { p_institution_id: inst.institutionId, p_from: W3, p_to: addDays(W3, 62) });
    expect(long.error).not.toBeNull();
  });

  it("swap accepted moves the duty atomically; only the target can respond", async () => {
    const day = addDays(W3, 40);
    const [asg] = await sql`insert into public.duty_assignments (institution_id, duty_type_id, staff_id, date) values (${inst.institutionId}, ${typeId}, ${staffA}, ${day}) returning id`;
    const req = await callAs(inst, "teacher", requestDutySwap, { assignmentId: asg!.id, toStaffId: staffB });
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    // The requester cannot accept their own request.
    expect((await callAs(inst, "teacher", respondDutySwap, { requestId: req.data.requestId, accept: true })).ok).toBe(false);
    const acc = await clientB.rpc("respond_duty_swap", { p_request_id: req.data.requestId, p_accept: true });
    expect(acc.error).toBeNull();
    const [row] = await sql`select staff_id, status from public.duty_assignments where id = ${asg!.id}`;
    expect(row).toEqual({ staff_id: staffB, status: "swapped" });
    const [rq] = await sql`select status from public.duty_swap_requests where id = ${req.data.requestId}`;
    expect(rq!.status).toBe("accepted");
  });

  it("a swap that would clash returns conflict and the duty stays put", async () => {
    const day = addDays(W3, 41);
    const [asg] = await sql`insert into public.duty_assignments (institution_id, duty_type_id, staff_id, date) values (${inst.institutionId}, ${typeId}, ${staffA}, ${day}) returning id`;
    const req = await callAs(inst, "teacher", requestDutySwap, { assignmentId: asg!.id, toStaffId: staffB });
    if (!req.ok) throw new Error("request failed");
    await sql`insert into public.duty_assignments (institution_id, duty_type_id, staff_id, date) values (${inst.institutionId}, ${typeId}, ${staffB}, ${day})`;
    const acc = await clientB.rpc("respond_duty_swap", { p_request_id: req.data.requestId, p_accept: true });
    expect(acc.error?.message).toBe("code:conflict");
    const [row] = await sql`select staff_id from public.duty_assignments where id = ${asg!.id}`;
    expect(row!.staff_id).toBe(staffA);
  });

  it("cross-tenant is refused", async () => {
    const [asg] = await sql`select id from public.duty_assignments where institution_id = ${inst.institutionId} limit 1`;
    expect((await callAs(other, "admin", generateDutyRoster, { from: W3, to: W3 })).ok).toBe(true); // own institution: no types, nothing created
    const gen = await other.clientAs("admin").rpc("generate_duty_roster", { p_institution_id: inst.institutionId, p_from: W3, p_to: W3 });
    expect(gen.error).not.toBeNull();
    const set = await other.clientAs("admin").rpc("set_duty_assignment", { p_assignment_id: asg!.id, p_cancel: true });
    expect(set.error).not.toBeNull();
    expect((await other.clientAs("admin").from("duty_assignments").select("id").eq("institution_id", inst.institutionId)).data ?? []).toHaveLength(0);
  });

  it("duty count per type is a name-free aggregate", async () => {
    const ctx = await buildContext(inst, "teacher");
    setActingClient(inst.clientAs("teacher") as never);
    const rows = await dutyCountByType(ctx, W1, addDays(W1, 3));
    setActingClient(null);
    expect(rows).toEqual([{ dutyType: "Gate", count: 4 }]);
  });

  it("duty_staff_options: a teacher gets colleague names and only staff_id + display_name", async () => {
    const { data, error } = await inst.clientAs("teacher").rpc("duty_staff_options", { p_institution_id: inst.institutionId });
    expect(error).toBeNull();
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["display_name", "staff_id"]);
    const names = new Map(rows.map((r) => [r.staff_id, r.display_name]));
    expect(names.get(staffB)).toBe("Teacher Two");
    expect(names.get(staffC)).toBe("Teacher C");
    expect(names.get(staffD)).toBe("Teacher D");

    // Through the queries: roster names resolve for a teacher; the swap picker lists colleagues, not self.
    const ctx = await buildContext(inst, "teacher");
    setActingClient(inst.clientAs("teacher") as never);
    try {
      const roster = await dutyRoster(ctx, W1, addDays(W1, 3));
      expect(roster).toHaveLength(4);
      expect(roster.every((r) => r.staffName !== null)).toBe(true);
      const options = (await dutyStaffOptions(ctx)).map((o) => o.id);
      expect(options).toEqual(expect.arrayContaining([staffB, staffC, staffD]));
      expect(options).not.toContain(staffA);
    } finally {
      setActingClient(null);
    }
  });

  it("duty_staff_options: students, guardians and other institutions' members are refused", async () => {
    for (const role of ["student", "guardian"] as const) {
      const r = await inst.clientAs(role).rpc("duty_staff_options", { p_institution_id: inst.institutionId });
      expect(r.error?.message).toBe("code:forbidden");
      expect(r.data).toBeNull();
    }
    const x = await other.clientAs("admin").rpc("duty_staff_options", { p_institution_id: inst.institutionId });
    expect(x.error?.message).toBe("code:not_found");
    expect(x.data).toBeNull();
  });

  it("duty_staff_options: inactive and non-teaching staff are absent", async () => {
    const [gone] = await sql`insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching, status) values (${inst.institutionId}, ${`EMP-G-${crypto.randomUUID().slice(0, 6)}`}, 'Teacher Gone', 'teacher', true, 'inactive') returning id`;
    const [clerk] = await sql`insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching) values (${inst.institutionId}, ${`EMP-O-${crypto.randomUUID().slice(0, 6)}`}, 'Office Clerk', 'clerk', false) returning id`;
    const { data, error } = await inst.clientAs("teacher").rpc("duty_staff_options", { p_institution_id: inst.institutionId });
    expect(error).toBeNull();
    const ids = ((data ?? []) as { staff_id: string }[]).map((r) => r.staff_id);
    expect(ids).toContain(staffB);
    expect(ids).not.toContain(gone!.id);
    expect(ids).not.toContain(clerk!.id);
  });
});
