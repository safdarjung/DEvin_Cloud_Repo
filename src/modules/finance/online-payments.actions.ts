"use server";

// M12-T11 (rulings: "Online payments", "Mode + honesty badges") — checkout
// intent for the Razorpay test-mode / simulated flow. `requireVisibleInvoice`
// mirrors actions.ts's `requireInvoice` (not exported there, so duplicated
// here rather than touching that shared file): institution-scoped select
// proves the invoice is visible under RLS (guardian of the student, or a
// finance role) before any gateway call, and turns a hidden row into
// `not_found` instead of an opaque RLS failure.
import { AppError, mapSqlError } from "@/lib/actions/result";
import { defineAction } from "@/lib/actions/define-action";
import { createClient } from "@/lib/supabase/server";
import { moneyToPaise } from "./queries";
import { createRazorpayOrder, onlinePaymentsMode } from "./razorpay";
import { CreatePaymentIntentSchema, type CreatePaymentIntentInput } from "./schemas";

type FinanceClient = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

interface VisibleInvoice {
  status: string;
  total: string | number;
  paid_total: string | number;
}

async function requireVisibleInvoice(supabase: FinanceClient, institutionId: string, id: string): Promise<VisibleInvoice> {
  const { data, error } = await supabase
    .from("invoices")
    .select("status, total, paid_total")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Invoice not found.");
  return data;
}

export interface CreatePaymentIntentResult {
  intentId: string;
  mode: "test" | "simulated";
  provider: "razorpay" | "simulated";
  orderId: string;
  amountPaise: number;
  currency: "INR";
  keyId: string | null;
}

export const createPaymentIntent = defineAction({
  name: "finance.payment.createIntent",
  module: "online_payments",
  schema: CreatePaymentIntentSchema,
  permission: "finance.payment.online",
  handler: async (input: CreatePaymentIntentInput, ctx): Promise<CreatePaymentIntentResult> => {
    const supabase = await createClient();
    const invoice = await requireVisibleInvoice(supabase, ctx.institution.id, input.invoiceId);

    const mode = onlinePaymentsMode();
    const keyId = mode === "test" ? (process.env.RAZORPAY_KEY_ID ?? null) : null;

    // Replay: a prior intent for this idempotency key is returned as-is —
    // no second gateway order (06 ruling "Online payments"), no second rpc.
    const { data: existing, error: existingError } = await supabase
      .from("online_payment_intents")
      .select("id, invoice_id, provider, provider_order_id, amount")
      .eq("institution_id", ctx.institution.id)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existingError) throwMapped(existingError);

    if (existing && existing.invoice_id !== input.invoiceId) {
      throw new AppError("conflict", "This idempotency key was already used for another invoice.");
    }
    if (existing) {
      return {
        intentId: existing.id,
        mode,
        provider: existing.provider as "razorpay" | "simulated",
        orderId: existing.provider_order_id,
        amountPaise: moneyToPaise(existing.amount),
        currency: "INR",
        keyId,
      };
    }

    // Same rules as create_payment_intent, checked BEFORE the gateway call so
    // a bad request never creates a Razorpay order (M12 security review).
    if (invoice.status !== "issued" && invoice.status !== "part_paid") {
      throw new AppError("invalid_state", "Invoice is not open for payment.");
    }
    if (moneyToPaise(input.amount) > moneyToPaise(invoice.total) - moneyToPaise(invoice.paid_total)) {
      throw new AppError("validation_failed", "Amount exceeds the invoice's outstanding balance.");
    }

    const provider: "razorpay" | "simulated" = mode === "test" ? "razorpay" : "simulated";
    const providerOrderId =
      provider === "razorpay"
        ? (
            await createRazorpayOrder({
              amountPaise: moneyToPaise(input.amount),
              receipt: input.idempotencyKey.replace(/-/g, ""),
              notes: { invoice_id: input.invoiceId },
            })
          ).orderId
        : `sim_order_${crypto.randomUUID().replace(/-/g, "")}`;

    const { data: intentId, error } = await supabase.rpc("create_payment_intent", {
      p_invoice_id: input.invoiceId,
      p_amount: input.amount,
      p_provider: provider,
      p_provider_order_id: providerOrderId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throwMapped(error);

    return {
      intentId: intentId as string,
      mode,
      provider,
      orderId: providerOrderId,
      amountPaise: moneyToPaise(input.amount),
      currency: "INR",
      keyId,
    };
  },
});
