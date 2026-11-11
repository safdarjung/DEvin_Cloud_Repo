import "server-only";
// Features-18 #3 — payroll reads (migration 0124). Always the signed-in
// user's RLS client: salary_structures and every payslip are visible only to
// owner/accountant; other staff see only their own payslips of finalized
// runs. The institution_id filters below are defense in depth.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { componentTotals, type SalaryComponent } from "./schemas";

const RUN_LIMIT = 24;
const MY_PAYSLIP_LIMIT = 36;

type DbComponent = { name: string; kind: SalaryComponent["kind"]; amount_paise: number };

function toComponents(raw: unknown): SalaryComponent[] {
  return (Array.isArray(raw) ? (raw as DbComponent[]) : []).map((c) => ({ name: c.name, kind: c.kind, amountPaise: Number(c.amount_paise) }));
}

export interface StaffSalaryRow {
  staffId: string;
  fullName: string;
  employeeNo: string;
  designation: string;
  structure: { id: string; components: SalaryComponent[]; grossPaise: number; netPaise: number } | null;
}

/** Active staff with their active salary structure (null when none is set). payroll.manage. */
export async function payrollStaffSalaries(ctx: TenantContext): Promise<StaffSalaryRow[]> {
  const supabase = await createClient();
  const [staffR, structR] = await Promise.all([
    supabase
      .from("staff")
      .select("id, full_name, employee_no, designation")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .order("full_name"),
    supabase.from("salary_structures").select("id, staff_id, components, gross_paise").eq("institution_id", ctx.institution.id).eq("is_active", true),
  ]);
  if (staffR.error) throw staffR.error;
  if (structR.error) throw structR.error;

  const byStaff = new Map(structR.data.map((s) => [s.staff_id, s]));
  return staffR.data.map((s) => {
    const st = byStaff.get(s.id);
    const components = st ? toComponents(st.components) : [];
    return {
      staffId: s.id,
      fullName: s.full_name,
      employeeNo: s.employee_no,
      designation: s.designation,
      structure: st ? { id: st.id, components, grossPaise: Number(st.gross_paise), netPaise: componentTotals(components).netPaise } : null,
    };
  });
}

export interface PayrollRunRow {
  id: string;
  month: string;
  status: "draft" | "finalized";
  finalizedAt: string | null;
  payslipCount: number;
  grossPaise: number;
  netPaise: number;
}

/** Latest 24 runs with totals, month desc. Name-free. payroll.manage. */
export async function payrollRuns(ctx: TenantContext): Promise<PayrollRunRow[]> {
  const supabase = await createClient();
  const { data: runs, error } = await supabase
    .from("payroll_runs")
    .select("id, month, status, finalized_at")
    .eq("institution_id", ctx.institution.id)
    .order("month", { ascending: false })
    .limit(RUN_LIMIT);
  if (error) throw error;

  // One read per run keeps each under PostgREST max_rows (1000).
  // shortcut: a school with >1000 staff would undercount, upgrade to a SQL sum function then.
  const slips = await Promise.all(
    runs.map(async (r) => {
      const res = await supabase.from("payslips").select("gross_paise, net_paise").eq("run_id", r.id).eq("institution_id", ctx.institution.id);
      if (res.error) throw res.error;
      return res.data;
    }),
  );

  return runs.map((r, i) => ({
    id: r.id,
    month: r.month,
    status: r.status as PayrollRunRow["status"],
    finalizedAt: r.finalized_at,
    payslipCount: slips[i].length,
    grossPaise: slips[i].reduce((sum, p) => sum + Number(p.gross_paise), 0),
    netPaise: slips[i].reduce((sum, p) => sum + Number(p.net_paise), 0),
  }));
}

export interface MonthlyPayrollCost {
  month: string;
  staffCount: number;
  grossPaise: number;
  netPaise: number;
}

/** Simulator input: finalized months only, no person identifiers. payroll.manage. */
export async function payrollMonthlyCost(ctx: TenantContext): Promise<MonthlyPayrollCost[]> {
  return (await payrollRuns(ctx))
    .filter((r) => r.status === "finalized")
    .map((r) => ({ month: r.month, staffCount: r.payslipCount, grossPaise: r.grossPaise, netPaise: r.netPaise }));
}

export interface PayslipRow {
  id: string;
  runId: string;
  month: string;
  runStatus: "draft" | "finalized";
  staffId: string;
  staffName: string | null;
  employeeNo: string | null;
  designation: string | null;
  components: SalaryComponent[];
  grossPaise: number;
  netPaise: number;
}

const PAYSLIP_SELECT = "id, run_id, staff_id, components, gross_paise, net_paise, payroll_runs(month, status), staff(full_name, employee_no, designation)";

type PayslipDbRow = {
  id: string;
  run_id: string;
  staff_id: string;
  components: unknown;
  gross_paise: number;
  net_paise: number;
  payroll_runs: { month: string; status: string } | null;
  staff: { full_name: string; employee_no: string; designation: string } | null;
};

function toPayslip(p: PayslipDbRow): PayslipRow {
  return {
    id: p.id,
    runId: p.run_id,
    month: p.payroll_runs?.month ?? "",
    runStatus: (p.payroll_runs?.status ?? "draft") as PayslipRow["runStatus"],
    staffId: p.staff_id,
    // staff RLS lets non-office staff read only their own linked row; null otherwise.
    staffName: p.staff?.full_name ?? null,
    employeeNo: p.staff?.employee_no ?? null,
    designation: p.staff?.designation ?? null,
    components: toComponents(p.components),
    grossPaise: Number(p.gross_paise),
    netPaise: Number(p.net_paise),
  };
}

/** One run and its payslips (staff name order). payroll.manage. Null when not visible. */
export async function payrollRunDetail(ctx: TenantContext, runId: string): Promise<{ run: PayrollRunRow; payslips: PayslipRow[] } | null> {
  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from("payroll_runs")
    .select("id, month, status, finalized_at")
    .eq("id", runId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!run) return null;

  const { data: slips, error: slipError } = await supabase.from("payslips").select(PAYSLIP_SELECT).eq("run_id", runId).eq("institution_id", ctx.institution.id);
  if (slipError) throw slipError;
  const payslips = (slips as unknown as PayslipDbRow[]).map(toPayslip).sort((x, y) => (x.staffName ?? "").localeCompare(y.staffName ?? ""));

  return {
    run: {
      id: run.id,
      month: run.month,
      status: run.status as PayrollRunRow["status"],
      finalizedAt: run.finalized_at,
      payslipCount: payslips.length,
      grossPaise: payslips.reduce((sum, p) => sum + p.grossPaise, 0),
      netPaise: payslips.reduce((sum, p) => sum + p.netPaise, 0),
    },
    payslips,
  };
}

/** One payslip. payslip.read; RLS returns only own finalized ones to non-managers. */
export async function payslipGet(ctx: TenantContext, payslipId: string): Promise<PayslipRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("payslips").select(PAYSLIP_SELECT).eq("id", payslipId).eq("institution_id", ctx.institution.id).maybeSingle();
  if (error) throw error;
  return data ? toPayslip(data as unknown as PayslipDbRow) : null;
}

export interface MyPayslipRow {
  id: string;
  month: string;
  grossPaise: number;
  netPaise: number;
}

/** The caller's own payslips of finalized runs, month desc. payslip.read. */
export async function myPayslips(ctx: TenantContext): Promise<MyPayslipRow[]> {
  const staffId = ctx.membership.staffId;
  if (!staffId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payslips")
    .select("id, gross_paise, net_paise, payroll_runs!inner(month, status)")
    .eq("institution_id", ctx.institution.id)
    .eq("staff_id", staffId)
    .eq("payroll_runs.status", "finalized")
    .order("created_at", { ascending: false })
    .limit(MY_PAYSLIP_LIMIT);
  if (error) throw error;
  return data
    .map((p) => ({ id: p.id, month: p.payroll_runs.month, grossPaise: Number(p.gross_paise), netPaise: Number(p.net_paise) }))
    .sort((x, y) => y.month.localeCompare(x.month));
}
