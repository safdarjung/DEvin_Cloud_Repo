// Curveball sweep (payroll): validation edges, deductions > earnings, concurrent generate/finalize, exact paise.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { finalizePayrollRun, generatePayrollRun, saveSalaryStructure } from "@/modules/payroll/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let a: TestInstitution;

async function staffIdOf(role: FixtureRole): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${a.institutionId} and role = ${role}`;
  return row.staff_id as string;
}

beforeAll(async () => {
  a = await createTestInstitution("payroll-cb");
}, 120_000);

afterAll(async () => {
  await a?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("payroll curveballs", () => {
  it.each([
    ["month 13", { month: "2026-13" }, "month"],
    ["single-digit month", { month: "2026-1" }, "month"],
    ["full date", { month: "2026-01-15" }, "month"],
  ])("generate: %s → validation_failed on month", async (_l, input, field) => {
    const r = await callAs(a, "accountant", generatePayrollRun, input);
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.[field]).toBeTruthy();
  });

  it.each([
    ["fractional paise", [{ name: "Basic", kind: "earning", amountPaise: 10.5 }]],
    ["negative paise", [{ name: "Basic", kind: "earning", amountPaise: -1 }]],
    ["no components", []],
    ["unknown kind", [{ name: "Basic", kind: "bonus", amountPaise: 100 }]],
  ])("save structure: %s → validation_failed with fieldErrors.components", async (_l, components) => {
    const r = await callAs(a, "accountant", saveSalaryStructure, { staffId: await staffIdOf("teacher"), components });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.components).toBeTruthy();
  });

  it("deductions above earnings, or deductions only, are refused as validation_failed — never a negative net", async () => {
    const staffId = await staffIdOf("admissions");
    const over = await callAs(a, "accountant", saveSalaryStructure, {
      staffId,
      components: [
        { name: "Basic", kind: "earning", amountPaise: 1_000_000 },
        { name: "Loan", kind: "deduction", amountPaise: 1_000_001 },
      ],
    });
    expect(over.ok ? null : over.error.code).toBe("validation_failed");
    const onlyDed = await callAs(a, "accountant", saveSalaryStructure, {
      staffId,
      components: [{ name: "Loan", kind: "deduction", amountPaise: 100 }],
    });
    expect(onlyDed.ok ? null : onlyDed.error.code).toBe("validation_failed");
    const [n] = await sql`select count(*)::int as n from public.salary_structures where staff_id = ${staffId}`;
    expect(n.n).toBe(0);
  });

  it("teacher, admin and guardian are forbidden from every payroll action", async () => {
    const staffId = await staffIdOf("teacher");
    for (const role of ["teacher", "guardian", "admin"] as const) {
      const s = await callAs(a, role, saveSalaryStructure, { staffId, components: [{ name: "Basic", kind: "earning", amountPaise: 1 }] });
      const g = await callAs(a, role, generatePayrollRun, { month: "2025-01" });
      const f = await callAs(a, role, finalizePayrollRun, { runId: crypto.randomUUID() });
      expect([s, g, f].map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["forbidden", "forbidden", "forbidden"]);
    }
  });

  it("finalize of an unknown run id → not_found", async () => {
    const r = await callAs(a, "accountant", finalizePayrollRun, { runId: crypto.randomUUID() });
    expect(r.ok ? null : r.error.code).toBe("not_found");
  });

  it("large paise amounts stay exact: gross and net are integer paise with no float drift", async () => {
    const staffId = await staffIdOf("exam_controller");
    const r = await callAs(a, "owner", saveSalaryStructure, {
      staffId,
      components: [
        { name: "Basic", kind: "earning", amountPaise: 9_999_999_999 },
        { name: "HRA", kind: "earning", amountPaise: 1 },
        { name: "TDS", kind: "deduction", amountPaise: 3 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.grossPaise).toBe(10_000_000_000);
    const run = await callAs(a, "accountant", generatePayrollRun, { month: "2025-05" });
    if (!run.ok) throw new Error(run.error.code);
    const [slip] = await sql`select gross_paise::text as g, net_paise::text as n from public.payslips where run_id = ${run.data.runId} and staff_id = ${staffId}`;
    expect([slip.g, slip.n]).toEqual(["10000000000", "9999999997"]);
  });

  it("generating the same month twice in parallel yields one run and one payslip per staff member", async () => {
    const teacher = await staffIdOf("teacher");
    const saved = await callAs(a, "accountant", saveSalaryStructure, { staffId: teacher, components: [{ name: "Basic", kind: "earning", amountPaise: 2_500_000 }] });
    expect(saved.ok).toBe(true);
    const rs = await Promise.all([1, 2, 3].map(() => callAs(a, "accountant", generatePayrollRun, { month: "2025-06" })));
    const ids = new Set(rs.map((r) => (r.ok ? r.data.runId : `ERR:${r.error.code}`)));
    expect([...ids].some((x) => x.startsWith("ERR:internal"))).toBe(false);
    const [runs] = await sql`select count(*)::int as n from public.payroll_runs where institution_id = ${a.institutionId} and month = '2025-06-01'`;
    expect(runs.n).toBe(1);
    const [dupes] = await sql`
      select count(*)::int as n from (select staff_id from public.payslips p join public.payroll_runs r on r.id = p.run_id
      where r.institution_id = ${a.institutionId} and r.month = '2025-06-01' group by staff_id having count(*) > 1) d
    `;
    expect(dupes.n).toBe(0);
  });

  it("finalizing the same run twice in parallel: exactly one succeeds, the other is invalid_state", async () => {
    const run = await callAs(a, "accountant", generatePayrollRun, { month: "2025-07" });
    if (!run.ok) throw new Error(run.error.code);
    const rs = await Promise.all([
      callAs(a, "accountant", finalizePayrollRun, { runId: run.data.runId }),
      callAs(a, "accountant", finalizePayrollRun, { runId: run.data.runId }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const failed = rs.find((r) => !r.ok);
    expect(failed && !failed.ok ? failed.error.code : null).toBe("invalid_state");
  });
});
