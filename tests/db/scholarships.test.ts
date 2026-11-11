// Features-18 #9 — scholarships (migration 0118): RLS matrix, the
// decide_concession_award definer (owner/principal only, approver ≠
// requester, exactly once), the percent XOR amount check, and the
// scholarships actions/queries. Real signed-in clients, real RLS.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { decideConcessionAward, requestConcessionAward, saveConcessionRule, setConcessionRuleActive } from "@/modules/scholarships/actions";
import { concessionAwardsQuery, concessionSummaryQuery } from "@/modules/scholarships/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let a: TestInstitution;
let b: TestInstitution;
let studentA: string;
let studentB: string;
let yearA: string;
let percentRule: string;
let amountRule: string;

async function studentOf(inst: TestInstitution): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function currentYear(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, '2026-27', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  return row.id as string;
}

async function request(role: FixtureRole, ruleId = percentRule, studentId = studentA): Promise<string> {
  const res = await callAs(a, role, requestConcessionAward, { studentId, ruleId, reason: "Sibling studies in grade IV" });
  if (!res.ok) throw new Error(`request as ${role} failed: ${res.error.code}`);
  return res.data.id;
}

async function statusOf(awardId: string): Promise<string> {
  const [row] = await sql`select status from public.concession_awards where id = ${awardId}`;
  return row.status as string;
}

beforeAll(async () => {
  a = await createTestInstitution("scholarships-a");
  b = await createTestInstitution("scholarships-b");
  studentA = await studentOf(a);
  studentB = await studentOf(b);
  yearA = await currentYear(a);
  await currentYear(b);

  const p = await callAs(a, "accountant", saveConcessionRule, { name: "Sibling", criteria: "Second child enrolled", percent: 10 });
  const m = await callAs(a, "admin", saveConcessionRule, { name: "Merit", amountPaise: 500_000 });
  if (!p.ok || !m.ok) throw new Error("rule setup failed");
  percentRule = p.data.id;
  amountRule = m.data.id;
}, 120_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("scholarships (0118)", () => {
  it("accountant requests an award: pending, requester is the caller, value copied from the rule", async () => {
    const id = await request("accountant", amountRule);
    const [row] = await sql`select status, requested_by, percent, amount_paise, academic_year_id, rule_id from public.concession_awards where id = ${id}`;
    expect(row.status).toBe("pending");
    expect(row.requested_by).toBe(a.users.accountant.id);
    expect(row.percent).toBeNull();
    expect(Number(row.amount_paise)).toBe(500_000);
    expect(row.academic_year_id).toBe(yearA);
    expect(row.rule_id).toBe(amountRule);
  });

  it("editing a rule does not change awards already requested under it", async () => {
    const id = await request("accountant");
    const edit = await callAs(a, "accountant", saveConcessionRule, { id: percentRule, name: "Sibling", percent: 15 });
    expect(edit.ok).toBe(true);
    const [row] = await sql`select percent from public.concession_awards where id = ${id}`;
    expect(Number(row.percent)).toBe(10);
    await callAs(a, "accountant", saveConcessionRule, { id: percentRule, name: "Sibling", percent: 10 });
  });

  it("the requester cannot approve their own award (action and definer); another approver can", async () => {
    const id = await request("principal");
    const viaAction = await callAs(a, "principal", decideConcessionAward, { awardId: id, decision: "approved" });
    expect(viaAction.ok ? null : viaAction.error.code).toBe("forbidden");
    const { error } = await a.clientAs("principal").rpc("decide_concession_award", { p_award_id: id, p_decision: "approved" });
    expect(error?.message).toBe("code:forbidden");
    expect(await statusOf(id)).toBe("pending");

    const byOwner = await callAs(a, "owner", decideConcessionAward, { awardId: id, decision: "approved", note: "Documents verified" });
    expect(byOwner.ok).toBe(true);
    const [row] = await sql`select status, decided_by, decided_at, decision_note from public.concession_awards where id = ${id}`;
    expect([row.status, row.decided_by, row.decision_note]).toEqual(["approved", a.users.owner.id, "Documents verified"]);
    expect(row.decided_at).not.toBeNull();
  });

  it("accountant and admin cannot approve (action gate and definer)", async () => {
    const id = await request("accountant");
    for (const role of ["accountant", "admin"] as const) {
      const res = await callAs(a, role, decideConcessionAward, { awardId: id, decision: "approved" });
      expect(res.ok ? null : res.error.code).toBe("forbidden");
      const { error } = await a.clientAs(role).rpc("decide_concession_award", { p_award_id: id, p_decision: "approved" });
      expect(error?.message).toBe("code:forbidden");
    }
    expect(await statusOf(id)).toBe("pending");
  });

  it("an award is decided exactly once: a second decision is refused", async () => {
    const id = await request("accountant");
    const first = await callAs(a, "principal", decideConcessionAward, { awardId: id, decision: "rejected", note: "Income proof missing" });
    expect(first.ok).toBe(true);
    const second = await callAs(a, "owner", decideConcessionAward, { awardId: id, decision: "approved" });
    expect(second.ok ? null : second.error.code).toBe("invalid_state");
    expect(await statusOf(id)).toBe("rejected");
  });

  it("a direct update of status is refused for every role (no UPDATE grant)", async () => {
    const id = await request("accountant");
    for (const role of ["owner", "principal", "accountant"] as const) {
      const { error } = await a.clientAs(role).from("concession_awards").update({ status: "approved" }).eq("id", id);
      expect(error).not.toBeNull();
    }
    expect(await statusOf(id)).toBe("pending");
  });

  it("percent and amount together are refused on rules and awards, and forging the requester is refused", async () => {
    const client = a.clientAs("accountant");
    const rule = await client.from("concession_rules").insert({ institution_id: a.institutionId, name: "Both", percent: 10, amount_paise: 100 });
    expect(rule.error?.code).toBe("23514");
    const award = await client.from("concession_awards").insert({
      institution_id: a.institutionId,
      student_id: studentA,
      academic_year_id: yearA,
      percent: 10,
      amount_paise: 100,
      reason: "Both values at once",
    });
    expect(award.error?.code).toBe("23514");
    const forged = await client.from("concession_awards").insert({
      institution_id: a.institutionId,
      student_id: studentA,
      academic_year_id: yearA,
      percent: 10,
      reason: "Requested in someone else's name",
      requested_by: a.users.admin.id,
    });
    expect(forged.error).not.toBeNull();
  });

  it("an inactive rule cannot be used for a new request", async () => {
    const r = await callAs(a, "accountant", saveConcessionRule, { name: "Old staff ward", percent: 50 });
    if (!r.ok) throw new Error("rule failed");
    const off = await callAs(a, "admin", setConcessionRuleActive, { id: r.data.id, isActive: false });
    expect(off.ok).toBe(true);
    const res = await callAs(a, "accountant", requestConcessionAward, { studentId: studentA, ruleId: r.data.id, reason: "Staff ward discount" });
    expect(res.ok ? null : res.error.code).toBe("invalid_state");
  });

  it("teacher is denied: actions forbidden, tables invisible, definer forbidden", async () => {
    const id = await request("accountant");
    const req = await callAs(a, "teacher", requestConcessionAward, { studentId: studentA, ruleId: percentRule, reason: "Teacher recommends this" });
    expect(req.ok ? null : req.error.code).toBe("forbidden");
    const rule = await callAs(a, "teacher", saveConcessionRule, { name: "Teacher rule", percent: 5 });
    expect(rule.ok ? null : rule.error.code).toBe("forbidden");

    const client = a.clientAs("teacher");
    expect((await client.from("concession_rules").select("id")).data).toEqual([]);
    expect((await client.from("concession_awards").select("id")).data).toEqual([]);
    const insert = await client.from("concession_rules").insert({ institution_id: a.institutionId, name: "Teacher rule", percent: 5 });
    expect(insert.error).not.toBeNull();
    const { error } = await client.rpc("decide_concession_award", { p_award_id: id, p_decision: "approved" });
    expect(error?.message).toBe("code:forbidden");
  });

  it("cross-tenant is refused: other school's staff cannot see, request for, or decide this school's awards", async () => {
    const id = await request("accountant");
    for (const role of ["owner", "accountant"] as const) {
      const client = b.clientAs(role);
      expect((await client.from("concession_awards").select("id").eq("id", id)).data).toEqual([]);
      expect((await client.from("concession_rules").select("id").eq("id", percentRule)).data).toEqual([]);
    }
    const { error } = await b.clientAs("owner").rpc("decide_concession_award", { p_award_id: id, p_decision: "approved" });
    expect(error?.message).toBe("code:not_found");
    const decide = await callAs(b, "owner", decideConcessionAward, { awardId: id, decision: "approved" });
    expect(decide.ok ? null : decide.error.code).toBe("not_found");

    // b's own rule, a's student: the insert policy binds student_id to b.
    const bRule = await callAs(b, "accountant", saveConcessionRule, { name: "Sibling", percent: 10 });
    if (!bRule.ok) throw new Error("b rule failed");
    const foreign = await callAs(b, "accountant", requestConcessionAward, { studentId: studentA, ruleId: bRule.data.id, reason: "Cross tenant attempt" });
    expect(foreign.ok ? null : foreign.error.code).toBe("not_found");
    // a's rule through b's route: not found.
    const foreignRule = await callAs(b, "accountant", requestConcessionAward, { studentId: studentB, ruleId: percentRule, reason: "Cross tenant rule" });
    expect(foreignRule.ok ? null : foreignRule.error.code).toBe("not_found");
    expect(await statusOf(id)).toBe("pending");
  });

  it("award list filters by status and names the requester; summary is name-free and counts approved only", async () => {
    await sql`update public.profiles set full_name = 'Test principal' where id = ${a.users.principal.id}`;
    const pending = await callAs(a, "accountant", concessionAwardsQuery, { status: "pending" });
    expect(pending.ok && pending.data.awards.length > 0 && pending.data.awards.every((w) => w.status === "pending")).toBe(true);
    // Other members' profile names are readable by owner/principal/admin only (memberships RLS, 0002).
    const list = await callAs(a, "owner", concessionAwardsQuery, { status: "approved" });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.awards.length).toBeGreaterThan(0);
    expect(list.data.awards.every((w) => w.status === "approved")).toBe(true);
    expect(list.data.awards[0]!.requestedByName).toBe("Test principal");

    const summary = await callAs(a, "admin", concessionSummaryQuery, {});
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    const [{ approved }] = await sql`select count(*)::int as approved from public.concession_awards where institution_id = ${a.institutionId} and status = 'approved'`;
    expect(summary.data.approvedCount).toBe(approved);
    expect(summary.data.byRule.reduce((s, r) => s + r.approvedCount, 0)).toBe(approved);
    expect(summary.data.byGrade.reduce((s, r) => s + r.approvedCount, 0)).toBe(approved);
    expect(JSON.stringify(summary.data)).not.toMatch(/studentId|admission|first_name|Test /);

    const teacher = await callAs(a, "teacher", concessionSummaryQuery, {});
    expect(teacher.ok ? null : teacher.error.code).toBe("forbidden");
  });
});
