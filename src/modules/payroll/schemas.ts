// Features-18 #3 — payroll Zod schemas (migration 0124). Money is integer
// paise. Component rules mirror app.guard_salary_structures_write so the UI
// fails fast; the trigger stays the authority and recomputes gross_paise.
// Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const SALARY_COMPONENT_KINDS = ["earning", "deduction"] as const;
export const MAX_SALARY_COMPONENTS = 20;
export const MAX_COMPONENT_PAISE = 10_000_000_000;

export const PAYROLL_LIMITED_NOTE = "No bank payout and no statutory deductions (PF/ESI/TDS).";

export const SalaryComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(SALARY_COMPONENT_KINDS),
    amountPaise: z.number().int().min(0).max(MAX_COMPONENT_PAISE),
  })
  .strict();
export type SalaryComponent = z.infer<typeof SalaryComponentSchema>;

export function componentTotals(components: readonly SalaryComponent[]): {
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
} {
  let grossPaise = 0;
  let deductionsPaise = 0;
  for (const c of components) {
    if (c.kind === "earning") grossPaise += c.amountPaise;
    else deductionsPaise += c.amountPaise;
  }
  return { grossPaise, deductionsPaise, netPaise: grossPaise - deductionsPaise };
}

export const SalaryStructureSaveSchema = z
  .object({
    staffId: uuid,
    components: z.array(SalaryComponentSchema).min(1).max(MAX_SALARY_COMPONENTS),
  })
  .strict()
  .superRefine(({ components }, issue) => {
    const { grossPaise, deductionsPaise } = componentTotals(components);
    if (grossPaise === 0) issue.addIssue({ code: "custom", path: ["components"], message: "Add at least one earning above zero." });
    if (deductionsPaise > grossPaise) issue.addIssue({ code: "custom", path: ["components"], message: "Deductions cannot exceed earnings." });
  });
export type SalaryStructureSaveInput = z.infer<typeof SalaryStructureSaveSchema>;

/** `YYYY-MM` (an `<input type="month">` value); the definer pins it to the 1st. */
export const PayrollRunGenerateSchema = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month.") })
  .strict();
export type PayrollRunGenerateInput = z.infer<typeof PayrollRunGenerateSchema>;

export const PayrollRunIdSchema = z.object({ runId: uuid }).strict();
export type PayrollRunIdInput = z.infer<typeof PayrollRunIdSchema>;

export const PayslipGetSchema = z.object({ payslipId: uuid }).strict();
export type PayslipGetInput = z.infer<typeof PayslipGetSchema>;

export const PayrollListSchema = z.object({}).strict();
