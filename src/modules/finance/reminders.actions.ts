"use server";

// M12-T8 — 06 ruling "Fee reminders": thin wrapper over
// `public.enqueue_fee_reminders` (20261028000074_finance_plus.sql), which
// itself re-proves the term belongs to this institution and re-checks the
// finance-reminder role (defense in depth, same shape as
// generateTermInvoices/enqueue_term_invoices in actions.ts). The RPC's
// return is `{jobId}` only (mirrors enqueue_term_invoices) — `asOf` is
// computed here the same way the SQL side does (institution-local "today",
// default Asia/Kolkata), from `ctx.institution.settings` already in hand,
// no extra round trip.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import {
  SendFeeRemindersSchema,
  SendInvoiceRemindersSchema,
  type SendFeeRemindersInput,
  type SendInvoiceRemindersInput,
} from "./schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** `new Intl.DateTimeFormat` with `timeZone` gives the institution-local calendar date, not the server's (same helper as attendance/actions.ts). */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

export interface SendFeeRemindersResult {
  jobId: string;
  asOf: string;
}

export const sendFeeReminders = defineAction({
  name: "finance.reminders.send",
  module: "finance_plus",
  schema: SendFeeRemindersSchema,
  permission: "finance.reminder.send",
  handler: async (input: SendFeeRemindersInput, ctx): Promise<SendFeeRemindersResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("enqueue_fee_reminders", {
      p_institution_id: ctx.institution.id,
      p_term_id: input.termId,
    });
    if (error) throwMapped(error);

    const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
    const asOf = todayInTimezone(locale.success ? locale.data.timezone : "Asia/Kolkata");
    const jobId = (data as { jobId: string } | null)?.jobId ?? "";
    return { jobId, asOf };
  },
});

export interface SendInvoiceRemindersResult {
  jobId: string;
  invoiceCount: number;
}

/** Bulk reminder for selected invoices/defaulters: thin wrapper over `public.enqueue_invoice_reminders` (0110), which re-proves every id and the role. */
export const sendInvoiceReminders = defineAction({
  name: "finance.reminders.sendSelected",
  module: "finance_plus",
  schema: SendInvoiceRemindersSchema,
  permission: "finance.reminder.send",
  handler: async (input: SendInvoiceRemindersInput, ctx): Promise<SendInvoiceRemindersResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("enqueue_invoice_reminders", {
      p_institution_id: ctx.institution.id,
      p_invoice_ids: input.invoiceIds,
    });
    if (error) throwMapped(error);
    const result = data as { jobId: string; invoiceCount: number } | null;
    return { jobId: result?.jobId ?? "", invoiceCount: result?.invoiceCount ?? 0 };
  },
});
