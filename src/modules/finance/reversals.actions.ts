"use server";

// M12-T7 — `finance.payment.void` (06 §W9, M12 rulings "Reversal",
// "app.void_payment"). Same institution-ownership-first shape as
// `recordPayment` in actions.ts: `requirePayment` proves the payment
// belongs to `ctx.institution` before the RPC ever runs (packet rule 2) —
// `public.void_payment` only checks the caller's role against the
// payment's own institution_id, not against the route's institution, so
// skipping this check would let a finance-void role in institution A probe
// payment ids from institution B as long as the id ever resolved (same
// BOLA shape the packet calls out for `recordPayment`). `app.void_payment`
// writes its own `finance.payment.voided` audit row — no second audit call
// here (SQL audits).
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { VoidPaymentSchema, type VoidPaymentInput } from "./schemas";

type FinanceClient = Awaited<ReturnType<typeof createClient>>;

// Local copy of actions.ts's `throwMapped` — that file is a shared registry
// read-only for this packet (BRIEF-COMMON.md), and the helper is a few lines
// with no shared state to extract.
function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function requirePayment(supabase: FinanceClient, institutionId: string, id: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("payments")
    .select("id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Payment not found.");
  return data;
}

export interface VoidPaymentResult {
  reversalId: string;
  invoiceId: string;
  invoiceStatus: string;
  paidTotal: number;
}

interface VoidPaymentRpcResult {
  reversal_id: string;
  invoice_id: string;
  invoice_status: string;
  paid_total: number;
}

export const voidPayment = defineAction({
  name: "finance.payment.void",
  module: "finance_plus",
  schema: VoidPaymentSchema,
  permission: "finance.payment.void",
  handler: async (input: VoidPaymentInput, ctx): Promise<VoidPaymentResult> => {
    const supabase = await createClient();
    await requirePayment(supabase, ctx.institution.id, input.paymentId);

    const { data, error } = await supabase.rpc("void_payment", {
      p_payment_id: input.paymentId,
      p_kind: input.kind,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throwMapped(error);
    const result = data as unknown as VoidPaymentRpcResult;

    // Best-effort lookup for the receipt revalidate path (packet: "revalidates
    // invoice/receipt/ledger/defaulters paths") — not the result payload, so
    // a miss (shouldn't happen, every payment has one receipt) is not fatal.
    const { data: receipt } = await supabase.from("receipts").select("id").eq("payment_id", input.paymentId).maybeSingle();

    revalidatePath(`/${ctx.institution.slug}/finance/invoices/${result.invoice_id}`);
    revalidatePath(`/${ctx.institution.slug}/finance/invoices`);
    revalidatePath(`/${ctx.institution.slug}/finance/ledger`);
    revalidatePath(`/${ctx.institution.slug}/finance/defaulters`);
    if (receipt) revalidatePath(`/${ctx.institution.slug}/finance/receipts/${receipt.id}`);

    return {
      reversalId: result.reversal_id,
      invoiceId: result.invoice_id,
      invoiceStatus: result.invoice_status,
      paidTotal: result.paid_total,
    };
  },
});
