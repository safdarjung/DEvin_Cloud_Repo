// Features-18 #3 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/payroll.<fn>. Name-free aggregates: payroll.runs,
// payroll.monthlyCost. Everything else carries staff identities or salaries.
import { defineQuery } from "@/lib/actions/define-query";
import { AppError } from "@/lib/actions/result";
import { PayrollListSchema, PayrollRunIdSchema, PayslipGetSchema } from "./schemas";
import { myPayslips, payrollMonthlyCost, payrollRunDetail, payrollRuns, payrollStaffSalaries, payslipGet } from "./queries";

/** Active staff with their salary structure (components, gross, net). */
export const payrollStructuresQuery = defineQuery({
  name: "payroll.structures",
  module: "payroll",
  schema: PayrollListSchema,
  permission: "payroll.manage",
  handler: (_input, ctx) => payrollStaffSalaries(ctx),
});

/** Latest payroll runs: month, status, payslip count, gross and net totals (no names). */
export const payrollRunsQuery = defineQuery({
  name: "payroll.runs",
  module: "payroll",
  schema: PayrollListSchema,
  permission: "payroll.manage",
  handler: (_input, ctx) => payrollRuns(ctx),
});

/** Monthly payroll cost of finalized months: staff count, gross and net totals (no names). */
export const payrollMonthlyCostQuery = defineQuery({
  name: "payroll.monthlyCost",
  module: "payroll",
  schema: PayrollListSchema,
  permission: "payroll.manage",
  handler: (_input, ctx) => payrollMonthlyCost(ctx),
});

/** One payroll run with every payslip in it. */
export const payrollRunQuery = defineQuery({
  name: "payroll.run",
  module: "payroll",
  schema: PayrollRunIdSchema,
  permission: "payroll.manage",
  handler: async ({ runId }, ctx) => {
    const detail = await payrollRunDetail(ctx, runId);
    if (!detail) throw new AppError("not_found", "Payroll run not found.");
    return detail;
  },
});

/** The caller's own payslips of finalized months. */
export const payrollMyPayslipsQuery = defineQuery({
  name: "payroll.myPayslips",
  module: "payroll",
  schema: PayrollListSchema,
  permission: "payslip.read",
  handler: (_input, ctx) => myPayslips(ctx),
});

/** One payslip; non-managers only ever see their own of a finalized month (RLS). */
export const payslipGetQuery = defineQuery({
  name: "payroll.payslip",
  module: "payroll",
  schema: PayslipGetSchema,
  permission: "payslip.read",
  handler: async ({ payslipId }, ctx) => {
    const payslip = await payslipGet(ctx, payslipId);
    if (!payslip) throw new AppError("not_found", "Payslip not found.");
    return payslip;
  },
});
