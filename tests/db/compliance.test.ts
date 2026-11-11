// Features-18 #22 — compliance: RLS, definer renewal, append-only events, immutable due_on.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createComplianceItem, deleteComplianceItem, loadComplianceStarter, renewComplianceItem } from "@/modules/compliance/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let inst: TestInstitution;
let other: TestInstitution;
let itemId: string;
let monthlyId: string;

beforeAll(async () => {
  inst = await createTestInstitution("cmp");
  other = await createTestInstitution("cmp-x");
  const a = await callAs(inst, "admin", createComplianceItem, { title: "Fire NOC", category: "safety", dueOn: "2030-03-01" });
  const b = await callAs(inst, "principal", createComplianceItem, { title: "Bus insurance", category: "transport", dueOn: "2030-01-15", renewEveryMonths: 12 });
  if (!a.ok || !b.ok) throw new Error("fixture items failed");
  itemId = a.data.id;
  monthlyId = b.data.id;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const dueOf = async (id: string) => (await sql`select due_on::text as d from public.compliance_items where id = ${id}`)[0]!.d as string;
const eventCount = async (id: string) => (await sql`select count(*)::int as n from public.compliance_events where item_id = ${id}`)[0]!.n as number;

describe("compliance", () => {
  it("accountant reads items, events and the summary but cannot manage", async () => {
    const rows = await inst.clientAs("accountant").from("compliance_items").select("id");
    expect(rows.data!.length).toBeGreaterThanOrEqual(2);
    const sum = await inst.clientAs("accountant").rpc("compliance_summary", { p_institution_id: inst.institutionId });
    expect(sum.error).toBeNull();
    expect(sum.data!.length).toBeGreaterThan(0);
    expect((await callAs(inst, "accountant", createComplianceItem, { title: "X", category: "other", dueOn: "2030-01-01" })).ok).toBe(false);
    expect((await callAs(inst, "accountant", renewComplianceItem, { itemId, newDueOn: "2031-03-01" })).ok).toBe(false);
    const rpc = await inst.clientAs("accountant").rpc("renew_compliance_item", {
      p_institution_id: inst.institutionId, p_item_id: itemId, p_renewed_on: null as unknown as string, p_new_due_on: "2031-03-01", p_document_id: null as unknown as string, p_note: null as unknown as string,
    });
    expect(rpc.error).not.toBeNull();
    const del = await inst.clientAs("accountant").from("compliance_items").delete().eq("id", itemId).select("id");
    expect(del.data ?? []).toHaveLength(0);
  });

  it("teacher is denied reads, summary and actions", async () => {
    const t = inst.clientAs("teacher");
    expect((await t.from("compliance_items").select("id")).data ?? []).toHaveLength(0);
    expect((await t.rpc("compliance_summary", { p_institution_id: inst.institutionId })).data ?? []).toHaveLength(0);
    expect((await callAs(inst, "teacher", createComplianceItem, { title: "X", category: "other", dueOn: "2030-01-01" })).ok).toBe(false);
  });

  it("direct due_on update is refused for managers", async () => {
    const { error } = await inst.clientAs("admin").from("compliance_items").update({ due_on: "2035-01-01" }).eq("id", itemId);
    expect(error).not.toBeNull();
    expect(await dueOf(itemId)).toBe("2030-03-01");
  });

  it("renew moves the date and writes exactly one event", async () => {
    const r = await callAs(inst, "admin", renewComplianceItem, { itemId, renewedOn: "2026-11-01", newDueOn: "2031-03-01", note: "Renewed" });
    expect(r.ok).toBe(true);
    expect(await dueOf(itemId)).toBe("2031-03-01");
    expect(await eventCount(itemId)).toBe(1);
  });

  it("renew with no new date adds the renewal period to the later of due date and renewal date", async () => {
    expect((await callAs(inst, "owner", renewComplianceItem, { itemId: monthlyId })).ok).toBe(true);
    expect(await dueOf(monthlyId)).toBe("2031-01-15");
  });

  it("renew without a date or a renewal period is refused, as is a new date not after the renewal", async () => {
    expect((await callAs(inst, "admin", renewComplianceItem, { itemId })).ok).toBe(false);
    const rpc = await inst.clientAs("admin").rpc("renew_compliance_item", {
      p_institution_id: inst.institutionId, p_item_id: itemId, p_renewed_on: "2026-11-01", p_new_due_on: "2026-10-01", p_document_id: null as unknown as string, p_note: null as unknown as string,
    });
    expect(rpc.error).not.toBeNull();
    expect(await eventCount(itemId)).toBe(1);
  });

  it("events cannot be updated or deleted", async () => {
    await expect(sql`update public.compliance_events set note = 'x' where item_id = ${itemId}`).rejects.toThrow();
    await expect(sql`delete from public.compliance_events where item_id = ${itemId}`).rejects.toThrow();
  });

  it("an item with a renewal cannot be deleted; one without can", async () => {
    const r = await callAs(inst, "admin", deleteComplianceItem, { id: itemId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/renewal history/i);
    const fresh = await callAs(inst, "admin", createComplianceItem, { title: "Temp", category: "other", dueOn: "2030-05-05" });
    if (!fresh.ok) throw new Error("fixture");
    expect((await callAs(inst, "admin", deleteComplianceItem, { id: fresh.data.id })).ok).toBe(true);
  });

  it("starter load adds only the titles given, with the admin's dates, and skips titles that already exist", async () => {
    const r = await callAs(inst, "admin", loadComplianceStarter, { items: [{ title: "Fire NOC", dueOn: "2030-01-01" }, { title: "Bus permit", dueOn: "2030-02-02" }] });
    expect(r.ok && r.data).toEqual({ created: 1, skipped: 1 });
    const [p] = await sql`select due_on::text as d, category from public.compliance_items where institution_id = ${inst.institutionId} and title = 'Bus permit'`;
    expect(p).toEqual({ d: "2030-02-02", category: "transport" });
    expect((await callAs(inst, "admin", loadComplianceStarter, { items: [{ title: "Made up item", dueOn: "2030-01-01" }] })).ok).toBe(false);
  });

  it("cross-tenant is refused", async () => {
    expect((await callAs(other, "admin", renewComplianceItem, { itemId, newDueOn: "2032-01-01" })).ok).toBe(false);
    const rpc = await other.clientAs("admin").rpc("renew_compliance_item", {
      p_institution_id: inst.institutionId, p_item_id: itemId, p_renewed_on: null as unknown as string, p_new_due_on: "2032-01-01", p_document_id: null as unknown as string, p_note: null as unknown as string,
    });
    expect(rpc.error).not.toBeNull();
    expect((await other.clientAs("admin").from("compliance_items").select("id").eq("institution_id", inst.institutionId)).data ?? []).toHaveLength(0);
    expect((await other.clientAs("admin").rpc("compliance_summary", { p_institution_id: inst.institutionId })).data ?? []).toHaveLength(0);
    expect(await dueOf(itemId)).toBe("2031-03-01");
  });
});
