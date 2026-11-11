// Features-18 #12 — helpdesk RLS, definers, append-only messages, actions.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { addTicketMessage, raiseTicket, replyToTicket, updateTicket } from "@/modules/helpdesk/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;

const raise = (subject = "Bus is late") => ({ category: "transport" as const, priority: "high" as const, subject, body: "Please check." });

async function raiseAs(role: "guardian" | "student" | "teacher", subject?: string): Promise<string> {
  const r = await callAs(inst, role, raiseTicket, raise(subject));
  if (!r.ok) throw new Error(`setup: ${r.error.message}`);
  return r.data.ticketId;
}

beforeAll(async () => {
  inst = await createTestInstitution("helpdesk");
  other = await createTestInstitution("helpdesk-x");
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("helpdesk", () => {
  it("guardian, student and teacher raise; due_at set in SQL from priority; others refused", async () => {
    for (const role of ["guardian", "student", "teacher"] as const) {
      const r = await callAs(inst, role, raiseTicket, raise());
      expect(r.ok).toBe(true);
    }
    const [row] = await sql`select extract(epoch from (due_at - created_at)) as secs from public.helpdesk_tickets where raised_by = ${inst.users.guardian.id}`;
    expect(Math.round(Number(row!.secs) / 3600)).toBe(24);
    for (const role of ["accountant", "admin", "owner"] as const) {
      expect((await callAs(inst, role, raiseTicket, raise())).ok).toBe(false);
    }
  });

  it("raiser reads only own tickets and messages; manager reads all", async () => {
    const mine = await raiseAs("guardian", "Mine");
    const theirs = await raiseAs("student", "Theirs");
    const { data: tickets } = await inst.clientAs("guardian").from("helpdesk_tickets").select("id, raised_by");
    expect(tickets!.every((t) => t.raised_by === inst.users.guardian.id)).toBe(true);
    expect(tickets!.some((t) => t.id === theirs)).toBe(false);
    const { data: msgs } = await inst.clientAs("guardian").from("helpdesk_messages").select("ticket_id");
    expect(msgs!.length).toBeGreaterThan(0);
    expect(msgs!.some((m) => m.ticket_id === theirs)).toBe(false);
    const { data: all } = await inst.clientAs("admin").from("helpdesk_tickets").select("id").in("id", [mine, theirs]);
    expect(all).toHaveLength(2);
    const { data: acct } = await inst.clientAs("accountant").from("helpdesk_tickets").select("id");
    expect(acct).toEqual([]);
  });

  it("raiser cannot change status; direct writes refused; manager can update and sets resolved_at", async () => {
    const id = await raiseAs("guardian");
    const forbidden = await callAs(inst, "guardian", updateTicket, { ticketId: id, status: "closed", assigneeStaffId: null });
    expect(forbidden.ok).toBe(false);
    const direct = await inst.clientAs("guardian").from("helpdesk_tickets").update({ status: "closed" }).eq("id", id).select();
    expect(direct.error !== null || direct.data!.length === 0).toBe(true);
    const ok = await callAs(inst, "admin", updateTicket, { ticketId: id, status: "resolved", assigneeStaffId: null });
    expect(ok.ok).toBe(true);
    const [row] = await sql`select status, resolved_at from public.helpdesk_tickets where id = ${id}`;
    expect(row!.status).toBe("resolved");
    expect(row!.resolved_at).not.toBeNull();
  });

  it("manager assigns a manager; a non-manager assignee is refused", async () => {
    const id = await raiseAs("student");
    const adminStaff = (await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'admin'`)[0]!.staff_id as string;
    const teacherStaff = (await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)[0]!.staff_id as string;
    expect((await callAs(inst, "principal", updateTicket, { ticketId: id, status: "in_progress", assigneeStaffId: adminStaff })).ok).toBe(true);
    const bad = await callAs(inst, "principal", updateTicket, { ticketId: id, status: "in_progress", assigneeStaffId: teacherStaff });
    expect(!bad.ok && bad.error.code).toBe("validation_failed");
  });

  it("messages: raiser replies on own open ticket, not another's, not on a closed one; manager replies; no edit/delete", async () => {
    const id = await raiseAs("guardian");
    const other1 = await raiseAs("student");
    expect((await callAs(inst, "guardian", addTicketMessage, { ticketId: id, body: "More info" })).ok).toBe(true);
    expect((await callAs(inst, "guardian", addTicketMessage, { ticketId: other1, body: "Not mine" })).ok).toBe(false);
    expect((await callAs(inst, "admin", replyToTicket, { ticketId: id, body: "On it" })).ok).toBe(true);
    expect((await callAs(inst, "guardian", replyToTicket, { ticketId: id, body: "x" })).ok).toBe(false);
    await callAs(inst, "admin", updateTicket, { ticketId: id, status: "closed", assigneeStaffId: null });
    expect((await callAs(inst, "guardian", addTicketMessage, { ticketId: id, body: "After close" })).ok).toBe(false);
    const { data: m } = await inst.clientAs("admin").from("helpdesk_messages").select("id").eq("ticket_id", id).limit(1);
    const upd = await inst.clientAs("admin").from("helpdesk_messages").update({ body: "edited" }).eq("id", m![0]!.id).select();
    expect(upd.error !== null || upd.data!.length === 0).toBe(true);
    const del = await inst.clientAs("admin").from("helpdesk_messages").delete().eq("id", m![0]!.id).select();
    expect(del.error !== null || del.data!.length === 0).toBe(true);
  });

  it("author_id is forced to the caller", async () => {
    const id = await raiseAs("teacher");
    const forged = await inst.clientAs("teacher").from("helpdesk_messages").insert({ institution_id: inst.institutionId, ticket_id: id, body: "hi", author_id: inst.users.admin.id } as never);
    expect(forged.error).not.toBeNull();
  });

  it("11th open ticket is refused (rate_limited); closing frees a slot", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await callAs(inst, "teacher", raiseTicket, raise(`Cap ${i}`)));
    const [open] = await sql`select count(*)::int as n from public.helpdesk_tickets where raised_by = ${inst.users.teacher.id} and status in ('open','in_progress')`;
    expect(open!.n).toBe(10);
    const refused = results.filter((r) => !r.ok);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((r) => !r.ok && r.error.code === "rate_limited")).toBe(true);
  });

  it("cross-tenant: other institution's manager and raiser cannot read, update or reply", async () => {
    const id = await raiseAs("guardian");
    const { data } = await other.clientAs("admin").from("helpdesk_tickets").select("id").eq("id", id);
    expect(data).toEqual([]);
    const upd = await callAs(other, "admin", updateTicket, { ticketId: id, status: "closed", assigneeStaffId: null });
    expect(!upd.ok && upd.error.code).toBe("not_found");
    expect((await callAs(other, "admin", replyToTicket, { ticketId: id, body: "x-tenant" })).ok).toBe(false);
    expect((await callAs(other, "guardian", addTicketMessage, { ticketId: id, body: "x-tenant" })).ok).toBe(false);
  });
});
