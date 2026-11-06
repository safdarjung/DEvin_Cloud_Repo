// M12-T8 — 06 ruling "Fee reminders". Payload: `{ term_id: uuid, as_of: date }`
// (`enqueue_fee_reminders`, 20261028000074_finance_plus.sql; idempotency key
// `fee_reminders:<term_id>:<as_of>` — one run per term per day). Every
// invoice/student/guardian/membership row below is re-read fresh when this
// handler runs, never trusted from the payload beyond term_id/as_of — an
// invoice paid between enqueue and run is excluded by the query itself, not
// by a payload snapshot.
import { z } from "zod";
import { createNotification } from "../../notifications/service.ts";
import type { JobHandler } from "../types.ts";

const PayloadSchema = z
  .object({
    term_id: z.string().uuid(),
    as_of: z.string().min(1),
  })
  .strict();

const PAGE_SIZE = 500;

// Same integer-paise approach as finance/queries.ts's moneyToPaise/
// paiseToMoney (T-032 money-float fix) — duplicated locally because that
// file imports "server-only" and can't be loaded by the job runner
// (relative .ts imports only, no @/ value imports, no server-only).
function outstandingOf(total: string | number, paidTotal: string | number): number {
  const toPaise = (raw: string | number): number => {
    const text = typeof raw === "number" ? raw.toString() : raw;
    const [whole, fraction = ""] = text.split(".");
    return Number(`${whole || "0"}${(fraction + "00").slice(0, 2)}`);
  };
  return (toPaise(total) - toPaise(paidTotal)) / 100;
}

function formatInr(rupees: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(rupees);
}

interface OverdueInvoice {
  id: string;
  student_id: string;
  invoice_no: string;
  due_on: string | null;
  total: string | number;
  paid_total: string | number;
}

export const feeReminder: JobHandler = async (job, { admin }) => {
  if (!job.institution_id) {
    throw new Error("finance.fee_reminder: job has no institution_id");
  }

  const parsed = PayloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    throw new Error("finance.fee_reminder: invalid payload");
  }
  const { term_id: termId, as_of: asOf } = parsed.data;

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("name, settings")
    .eq("id", job.institution_id)
    .single();
  if (institutionError) throw institutionError;

  const languages = (institution.settings as { communication?: { languages?: unknown } } | null)?.communication
    ?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  // T-043 load-test lesson applies to the service role too (06 ruling):
  // page explicitly, never rely on PostgREST's default 1,000-row cap.
  const invoices: OverdueInvoice[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await admin
      .from("invoices")
      .select("id, student_id, invoice_no, due_on, total, paid_total")
      .eq("institution_id", job.institution_id)
      .eq("term_id", termId)
      .in("status", ["issued", "part_paid"])
      .lt("due_on", asOf)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    invoices.push(...((page as OverdueInvoice[] | null) ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }

  // X04-T9 — ruling "Defaulters respect instalments": same RPC as
  // `listDefaulters`, service role. A plan invoice (any `invoice_
  // instalments` row for this term) is skipped unless one of its parts
  // is `overdue`; a no-plan invoice (absent from this map) is unaffected.
  const hasOverduePart = new Set<string>();
  const planInvoiceIds = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await admin
      .rpc("invoice_instalment_status", { p_institution_id: job.institution_id, p_term_id: termId })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of (page as { invoice_id: string; status: string }[] | null) ?? []) {
      planInvoiceIds.add(row.invoice_id);
      if (row.status === "overdue") hasOverduePart.add(row.invoice_id);
    }
    if (!page || page.length < PAGE_SIZE) break;
  }

  for (const invoice of invoices) {
    if (planInvoiceIds.has(invoice.id) && !hasOverduePart.has(invoice.id)) continue; // plan invoice, no overdue part — not a defaulter

    const outstanding = outstandingOf(invoice.total, invoice.paid_total);
    if (outstanding <= 0) continue; // re-check at send: fully paid since the query ran

    const { data: primary, error: primaryError } = await admin
      .from("guardian_students")
      .select("guardian_id")
      .eq("student_id", invoice.student_id)
      .eq("is_primary", true)
      .maybeSingle();
    if (primaryError) throw primaryError;
    if (!primary) continue; // no primary guardian configured — nothing to notify

    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .select("user_id")
      .eq("institution_id", job.institution_id)
      .eq("guardian_id", primary.guardian_id)
      .eq("role", "guardian")
      .eq("status", "active")
      // A guardian may hold several active accounts (no unique on guardian_id): one recipient, oldest first.
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) continue; // guardian has no active portal account

    const { data: guardian, error: guardianError } = await admin
      .from("guardians")
      .select("phone, email")
      .eq("id", primary.guardian_id)
      .single();
    if (guardianError) throw guardianError;

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("first_name, last_name")
      .eq("id", invoice.student_id)
      .single();
    if (studentError) throw studentError;

    const { notificationId } = await createNotification(admin, {
      institutionId: job.institution_id,
      recipientUserId: membership.user_id,
      type: "fee_reminder",
      entityId: `${invoice.id}:${asOf}`,
      lang,
      vars: {
        student: [student.first_name, student.last_name].filter(Boolean).join(" "),
        invoice_no: invoice.invoice_no,
        amount: formatInr(outstanding),
        due_on: invoice.due_on ?? "",
        school: institution.name,
      },
      contacts: { sms: guardian.phone, email: guardian.email },
    });

    const { error: logError } = await admin.from("fee_reminders").upsert(
      {
        institution_id: job.institution_id,
        invoice_id: invoice.id,
        student_id: invoice.student_id,
        recipient_user_id: membership.user_id,
        notification_id: notificationId,
        reminder_date: asOf,
        outstanding,
      },
      { onConflict: "invoice_id,recipient_user_id,reminder_date", ignoreDuplicates: true },
    );
    if (logError) throw logError;
  }
};
