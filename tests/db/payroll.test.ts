// Features-18 #3 — payroll (migration 0124): RLS matrix, the two definers
// (generate_payroll_run / finalize_payroll_run), immutability guards and the
// payroll actions/queries. Real signed-in clients, real RLS.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { finalizePayrollRun, generatePayrollRun, saveSalaryStructure } from "@/modules/payroll/actions";
import { payrollMonthlyCostQuery, payslipGetQuery } from "@/modules/payroll/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let a: TestInstitution;
let b: TestInstitution;

async function staffIdOf(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = ${role}`;
  return row.staff_id as string;
}

const earning = (name: string, amount_paise: number) => ({ name, kind: "earning", amount_paise });
const deduction = (name: string, amount_paise: number) => ({ name, kind: "deduction", amount_paise });

async function seedStructure(inst: TestInstitution, role: FixtureRole, components: object[]): Promise<void> {
  await sql`
    insert into public.salary_structures (institution_id, staff_id, components, created_by)
    values (${inst.institutionId}, ${await staffIdOf(inst, role)}, ${sql.json(components as never)}, ${inst.users.accountant.id})
  `;
}

async function payslipIdFor(runId: string, staffId: string): Promise<string> {
  const [row] = await sql`select id from public.payslips where run_id = ${runId} and staff_id = ${staffId}`;
  return row.id as string;
}

async function generate(inst: TestInstitution, month: string): Promise<string> {
  const res = await callAs(inst, "accountant", generatePayrollRun, { month });
  if (!res.ok) throw new Error(`generate ${month} failed: ${res.error.code}`);
  return res.data.runId;
}

beforeAll(async () => {
  a = await createTestInstitution("payroll-a");
  b = await createTestInstitution("payroll-b");
  await seedStructure(a, "teacher", [earning("Basic", 3_000_000), earning("HRA", 1_200_000), deduction("Advance recovery", 200_000)]);
  await seedStructure(a, "exam_controller", [earning("Basic", 4_000_000)]);
  await seedStructure(a, "accountant", [earning("Basic", 3_500_000)]);
}, 120_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("payroll (0124)", () => {
  it("gross_paise is computed by the trigger from components, never trusted from the client", async () => {
    const [teacherRow] = await sql`select gross_paise from public.salary_structures where staff_id = ${await staffIdOf(a, "teacher")} and is_active`;
    expect(Number(teacherRow.gross_paise)).toBe(4_200_000);

    const principalStaff = await staffIdOf(a, "principal");
    const { data, error } = await a
      .clientAs("accountant")
      .from("salary_structures")
      .insert({ institution_id: a.institutionId, staff_id: principalStaff, components: [earning("Basic", 9_000_000)], gross_paise: 1, created_by: a.users.accountant.id })
      .select("gross_paise")
      .single();
    expect(error).toBeNull();
    expect(Number(data!.gross_paise)).toBe(9_000_000);
  });

  it("owner and accountant save structures through the action (insert, then update in place)", async () => {
    const admissionsStaff = await staffIdOf(a, "admissions");
    const first = await callAs(a, "owner", saveSalaryStructure, {
      staffId: admissionsStaff,
      components: [{ name: "Basic", kind: "earning", amountPaise: 2_500_000 }],
    });
    expect(first.ok).toBe(true);
    const second = await callAs(a, "accountant", saveSalaryStructure, {
      staffId: admissionsStaff,
      components: [
        { name: "Basic", kind: "earning", amountPaise: 2_600_000 },
        { name: "Leave without pay", kind: "deduction", amountPaise: 100_000 },
      ],
    });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.id).toBe(first.data.id);
    const rows = await sql`select gross_paise from public.salary_structures where staff_id = ${admissionsStaff} and is_active`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].gross_paise)).toBe(2_600_000);
  });

  it("admin and principal are denied payroll.manage at the action, RLS and definer layers", async () => {
    const teacherStaff = await staffIdOf(a, "teacher");
    for (const role of ["admin", "principal"] as const) {
      const save = await callAs(a, role, saveSalaryStructure, { staffId: teacherStaff, components: [{ name: "Basic", kind: "earning", amountPaise: 1 }] });
      expect(save.ok ? null : save.error.code).toBe("forbidden");
      const gen = await callAs(a, role, generatePayrollRun, { month: "2026-05" });
      expect(gen.ok ? null : gen.error.code).toBe("forbidden");

      const client = a.clientAs(role);
      const { data: structures } = await client.from("salary_structures").select("id");
      expect(structures).toEqual([]);
      const { error: insertError } = await client
        .from("salary_structures")
        .insert({ institution_id: a.institutionId, staff_id: teacherStaff, components: [earning("Basic", 1)], created_by: a.users[role].id });
      expect(insertError).not.toBeNull();
      const { error: rpcError } = await client.rpc("generate_payroll_run", { p_institution_id: a.institutionId, p_month: "2026-05-01" });
      expect(rpcError?.message).toBe("code:forbidden");
    }
  });

  it("generate builds a draft from active structures; re-generating the draft month rebuilds it; finalize locks the month", async () => {
    const teacherStaff = await staffIdOf(a, "teacher");
    const runId = await generate(a, "2026-01");
    const [{ expected }] = await sql`
      select count(*)::int as expected from public.salary_structures ss join public.staff s on s.id = ss.staff_id
      where ss.institution_id = ${a.institutionId} and ss.is_active and s.status = 'active'
    `;
    const [{ n }] = await sql`select count(*)::int as n from public.payslips where run_id = ${runId}`;
    expect(n).toBe(expected);
    const [slip] = await sql`select gross_paise, net_paise from public.payslips where run_id = ${runId} and staff_id = ${teacherStaff}`;
    expect([Number(slip.gross_paise), Number(slip.net_paise)]).toEqual([4_200_000, 4_000_000]);

    const raised = await callAs(a, "accountant", saveSalaryStructure, {
      staffId: teacherStaff,
      components: [{ name: "Basic", kind: "earning", amountPaise: 3_300_000 }],
    });
    expect(raised.ok).toBe(true);
    expect(await generate(a, "2026-01")).toBe(runId);
    const [rebuilt] = await sql`select net_paise from public.payslips where run_id = ${runId} and staff_id = ${teacherStaff}`;
    expect(Number(rebuilt.net_paise)).toBe(3_300_000);

    const fin = await callAs(a, "accountant", finalizePayrollRun, { runId });
    expect(fin.ok).toBe(true);
    const [run] = await sql`select status, finalized_at, finalized_by from public.payroll_runs where id = ${runId}`;
    expect(run.status).toBe("finalized");
    expect(run.finalized_at).not.toBeNull();
    expect(run.finalized_by).toBe(a.users.accountant.id);

    const again = await callAs(a, "accountant", generatePayrollRun, { month: "2026-01" });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
    const refinalize = await callAs(a, "owner", finalizePayrollRun, { runId });
    expect(refinalize.ok ? null : refinalize.error.code).toBe("invalid_state");
    const [{ runs }] = await sql`select count(*)::int as runs from public.payroll_runs where institution_id = ${a.institutionId} and month = '2026-01-01'`;
    expect(runs).toBe(1);
  });

  it("finalizing a run with no payslips is refused", async () => {
    const emptyRun = await generate(b, "2026-02");
    const fin = await callAs(b, "accountant", finalizePayrollRun, { runId: emptyRun });
    expect(fin.ok ? null : fin.error.code).toBe("invalid_state");
  });

  it("staff read only their own payslips of finalized runs; never another's, never a draft", async () => {
    const teacherStaff = await staffIdOf(a, "teacher");
    const examStaff = await staffIdOf(a, "exam_controller");
    const finalRun = await generate(a, "2026-03");
    expect((await callAs(a, "accountant", finalizePayrollRun, { runId: finalRun })).ok).toBe(true);
    const draftRun = await generate(a, "2026-04");

    const ownFinal = await payslipIdFor(finalRun, teacherStaff);
    const ownDraft = await payslipIdFor(draftRun, teacherStaff);
    const othersFinal = await payslipIdFor(finalRun, examStaff);

    const teacher = a.clientAs("teacher");
    const { data: visible } = await teacher.from("payslips").select("id, staff_id, run_id");
    const ids = (visible ?? []).map((p) => p.id);
    expect(ids).toContain(ownFinal);
    expect(ids).not.toContain(ownDraft);
    expect(ids).not.toContain(othersFinal);
    expect((visible ?? []).every((p) => p.staff_id === teacherStaff)).toBe(true);

    const { data: runs } = await teacher.from("payroll_runs").select("id, status");
    expect((runs ?? []).map((r) => r.id)).not.toContain(draftRun);
    expect((runs ?? []).every((r) => r.status === "finalized")).toBe(true);

    for (const role of ["student", "guardian"] as const) {
      const { data } = await a.clientAs(role).from("payslips").select("id");
      expect(data).toEqual([]);
    }

    const mine = await callAs(a, "teacher", payslipGetQuery, { payslipId: ownFinal });
    expect(mine.ok).toBe(true);
    const others = await callAs(a, "teacher", payslipGetQuery, { payslipId: othersFinal });
    expect(others.ok ? null : others.error.code).toBe("not_found");
    const draft = await callAs(a, "teacher", payslipGetQuery, { payslipId: ownDraft });
    expect(draft.ok ? null : draft.error.code).toBe("not_found");
  });

  it("payslips and runs of a finalized month cannot be updated or deleted", async () => {
    const runId = await generate(a, "2026-06");
    expect((await callAs(a, "accountant", finalizePayrollRun, { runId })).ok).toBe(true);
    const slipId = await payslipIdFor(runId, await staffIdOf(a, "teacher"));

    await expect(sql`update public.payslips set net_paise = 0 where id = ${slipId}`).rejects.toThrow("code:invalid_state");
    await expect(sql`delete from public.payslips where id = ${slipId}`).rejects.toThrow("code:invalid_state");
    await expect(sql`update public.payroll_runs set status = 'draft', finalized_at = null where id = ${runId}`).rejects.toThrow("code:invalid_state");
    await expect(sql`delete from public.payroll_runs where id = ${runId}`).rejects.toThrow("code:invalid_state");

    const owner = a.clientAs("owner");
    const { error: updateError } = await owner.from("payslips").update({ net_paise: 0 }).eq("id", slipId);
    expect(updateError).not.toBeNull();
    await owner.from("payslips").delete().eq("id", slipId);
    const [still] = await sql`select net_paise from public.payslips where id = ${slipId}`;
    expect(Number(still.net_paise)).toBeGreaterThan(0);
  });

  it("monthly cost aggregate is name-free and payroll.manage only", async () => {
    const res = await callAs(a, "accountant", payrollMonthlyCostQuery, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const march = res.data.find((m) => m.month === "2026-03-01");
    expect(march).toBeDefined();
    expect(Object.keys(march!).sort()).toEqual(["grossPaise", "month", "netPaise", "staffCount"]);
    const [totals] = await sql`
      select count(*)::int as staff, sum(p.gross_paise)::bigint as gross from public.payslips p
      join public.payroll_runs r on r.id = p.run_id where r.institution_id = ${a.institutionId} and r.month = '2026-03-01'
    `;
    expect(march!.staffCount).toBe(totals.staff);
    expect(march!.grossPaise).toBe(Number(totals.gross));
    expect(res.data.some((m) => m.month === "2026-04-01")).toBe(false);

    const denied = await callAs(a, "principal", payrollMonthlyCostQuery, {});
    expect(denied.ok ? null : denied.error.code).toBe("forbidden");
  });

  it("cross-tenant: another school's accountant cannot read, generate, finalize or write structures here", async () => {
    const draftRun = await generate(a, "2026-07");
    const teacherA = await staffIdOf(a, "teacher");
    const bAccountant = b.clientAs("accountant");

    const { error: genError } = await bAccountant.rpc("generate_payroll_run", { p_institution_id: a.institutionId, p_month: "2026-08-01" });
    expect(genError?.message).toBe("code:forbidden");
    const { error: finError } = await bAccountant.rpc("finalize_payroll_run", { p_run_id: draftRun });
    expect(finError?.message).toBe("code:forbidden");

    const { data: slips } = await bAccountant.from("payslips").select("id").eq("institution_id", a.institutionId);
    expect(slips).toEqual([]);
    const { data: structures } = await bAccountant.from("salary_structures").select("id").eq("institution_id", a.institutionId);
    expect(structures).toEqual([]);

    for (const institution_id of [a.institutionId, b.institutionId]) {
      const { error } = await bAccountant
        .from("salary_structures")
        .insert({ institution_id, staff_id: teacherA, components: [earning("Basic", 1)], created_by: b.users.accountant.id });
      expect(error).not.toBeNull();
    }
    const viaAction = await callAs(b, "accountant", saveSalaryStructure, { staffId: teacherA, components: [{ name: "Basic", kind: "earning", amountPaise: 1 }] });
    expect(viaAction.ok).toBe(false);
  });
});
