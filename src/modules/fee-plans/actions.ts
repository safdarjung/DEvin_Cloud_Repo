"use server";

// X04-T5 — fee-plans module actions (06 §W9, 07 §2.2 finance.plan.manage).
// `upsertLateFeeRule` is a direct RLS upsert (same shape as
// finance.actions.ts's upsertFeeStructure) — RLS already re-checks the
// fee_structure's institution in `with check`, but the id is also verified
// here first (packet rule 2) so a cross-tenant or missing structure
// surfaces as `not_found`, not an opaque RLS-policy-violation mapped to
// `internal`. `setInstalments` proves the invoice, then defers entirely to
// `public.set_invoice_instalments` (0087, X04-T2) — no TypeScript here
// ever writes `invoice_instalments` directly.
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  LateFeeRuleUpsertSchema,
  SetInstalmentsSchema,
  type LateFeeRuleUpsertInput,
  type SetInstalmentsInput,
} from "@/modules/fee-plans/schemas";

type FeePlansClient = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

// Ruling "ErrorCode map": validation_failed from set_invoice_instalments
// (bad part count/dates/amounts/sum) reports against the `parts` field.
function throwMappedParts(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  if (mapped.error.code === "validation_failed") {
    throw new AppError("validation_failed", mapped.error.message, { parts: [mapped.error.message] });
  }
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function requireFeeStructure(supabase: FeePlansClient, institutionId: string, id: string): Promise<void> {
  const { data, error } = await supabase
    .from("fee_structures")
    .select("id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Fee structure not found.");
}

interface InvoiceRow {
  id: string;
}

async function requireInvoice(supabase: FeePlansClient, institutionId: string, id: string): Promise<InvoiceRow> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Invoice not found.");
  return data;
}

export const upsertLateFeeRule = defineAction({
  name: "feePlans.lateFeeRule.upsert",
  module: "fee_plans",
  schema: LateFeeRuleUpsertSchema,
  permission: "finance.plan.manage",
  handler: async (input: LateFeeRuleUpsertInput, ctx) => {
    const supabase = await createClient();
    await requireFeeStructure(supabase, ctx.institution.id, input.feeStructureId);

    const { data, error } = await supabase
      .from("late_fee_rules")
      .upsert(
        {
          institution_id: ctx.institution.id,
          fee_structure_id: input.feeStructureId,
          kind: input.kind,
          amount: input.amount,
          grace_days: input.graceDays,
          cap: input.cap ?? null,
          is_active: input.isActive,
          updated_by: ctx.user.id,
        },
        { onConflict: "fee_structure_id" },
      )
      .select("id")
      .single();
    if (error) throwMapped(error);

    await audit(ctx, {
      action: "fee_plans.late_fee_rule.upserted",
      entityType: "late_fee_rule",
      entityId: data.id,
      after: {
        feeStructureId: input.feeStructureId,
        kind: input.kind,
        amount: input.amount,
        graceDays: input.graceDays,
        cap: input.cap ?? null,
        isActive: input.isActive,
      },
    });

    revalidatePath(`/${ctx.institution.slug}/finance/structures/${input.feeStructureId}`);
    return { id: data.id as string, feeStructureId: input.feeStructureId };
  },
});

export const setInstalments = defineAction({
  name: "feePlans.instalments.set",
  module: "fee_plans",
  schema: SetInstalmentsSchema,
  permission: "finance.plan.manage",
  handler: async (input: SetInstalmentsInput, ctx) => {
    const supabase = await createClient();
    await requireInvoice(supabase, ctx.institution.id, input.invoiceId);

    const { error } = await supabase.rpc("set_invoice_instalments", {
      p_invoice_id: input.invoiceId,
      p_parts: input.parts.map((part) => ({ due_on: part.dueOn, amount: part.amount })),
    });
    if (error) throwMappedParts(error);

    // No second audit (packet rule 25): public.set_invoice_instalments
    // already writes `fee_plans.instalments.set` via app.audit.
    revalidatePath(`/${ctx.institution.slug}/finance/invoices/${input.invoiceId}`);
    revalidatePath(`/${ctx.institution.slug}/finance/invoices`);
    return { invoiceId: input.invoiceId, parts: input.parts };
  },
});
