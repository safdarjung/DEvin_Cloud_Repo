"use server";

// Features-18 #3 — payroll.structure.save / payroll.run.generate /
// payroll.run.finalize (migration 0124). Money is integer paise.
// gross_paise is never sent: app.guard_salary_structures_write recomputes it
// from `components`. Runs and payslips are written only by the two definers
// (generate_payroll_run / finalize_payroll_run), which also re-check
// owner/accountant, the month's state and write their own audit rows — so
// those two actions do not call audit() again. Never AI-draftable (§E).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  PayrollRunGenerateSchema,
  PayrollRunIdSchema,
  SalaryStructureSaveSchema,
  type PayrollRunGenerateInput,
  type PayrollRunIdInput,
  type SalaryStructureSaveInput,
} from "@/modules/payroll/schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

/** One active structure per staff member: updates it in place, else inserts it. */
export const saveSalaryStructure = defineAction({
  name: "payroll.structure.save",
  module: "payroll",
  schema: SalaryStructureSaveSchema,
  permission: "payroll.manage",
  handler: async ({ staffId, components }: SalaryStructureSaveInput, ctx) => {
    const supabase = await createClient();
    const rows = components.map((c) => ({ name: c.name, kind: c.kind, amount_paise: c.amountPaise }));

    const { data: current, error: readError } = await supabase
      .from("salary_structures")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("staff_id", staffId)
      .eq("is_active", true)
      .maybeSingle();
    if (readError) throwMapped(readError);

    const write = current
      ? supabase.from("salary_structures").update({ components: rows }).eq("id", current.id).eq("institution_id", ctx.institution.id)
      : supabase.from("salary_structures").insert({ institution_id: ctx.institution.id, staff_id: staffId, components: rows, created_by: ctx.user.id });
    const { data, error } = await write.select("id, gross_paise").single();
    if (error) {
      // The insert policy binds staff_id to this institution (app.staff_in_institution).
      if (isRlsViolation(error)) throw new AppError("not_found", "Staff member not found in this school.");
      throwMapped(error);
    }

    await audit(ctx, {
      action: "payroll.structure.save",
      entityType: "salary_structures",
      entityId: data.id,
      after: { componentCount: rows.length },
    });

    return { id: data.id as string, grossPaise: Number(data.gross_paise) };
  },
});

export const generatePayrollRun = defineAction({
  name: "payroll.run.generate",
  module: "payroll",
  schema: PayrollRunGenerateSchema,
  permission: "payroll.manage",
  handler: async ({ month }: PayrollRunGenerateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("generate_payroll_run", { p_institution_id: ctx.institution.id, p_month: `${month}-01` });
    if (error) throwMapped(error);
    return { runId: data as string };
  },
});

export const finalizePayrollRun = defineAction({
  name: "payroll.run.finalize",
  module: "payroll",
  schema: PayrollRunIdSchema,
  permission: "payroll.manage",
  handler: async ({ runId }: PayrollRunIdInput, ctx) => {
    const supabase = await createClient();
    // The definer resolves the run's institution itself; this pre-check only
    // keeps a run id from another school the caller also manages out of this route.
    const { data: run, error: readError } = await supabase
      .from("payroll_runs")
      .select("id")
      .eq("id", runId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!run) throw new AppError("not_found", "Payroll run not found.");

    const { data, error } = await supabase.rpc("finalize_payroll_run", { p_run_id: runId });
    if (error) throwMapped(error);
    return { runId: data as string };
  },
});
