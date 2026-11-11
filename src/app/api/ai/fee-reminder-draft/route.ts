import "server-only";
// features-18 §C #17 — per-row "Draft reminder" on /finance/defaulters.
// The invoice is re-read from that term's open invoices (listDefaulters,
// instalment-aware due date) under the caller's RLS. The prompt gets amount
// due, due date, days overdue, term and school name only; the model writes
// name placeholders that are filled with first names here, after the call —
// no name, phone, address or other child ever reaches the model. Output is
// copyable text; sending stays with the existing reminder action. Writes
// nothing but usage. Permission: finance.structure.manage, as the page.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { formatINR } from "@/lib/format";
import {
  FeeReminderGenerationSchema,
  FeeReminderRequestSchema,
  fillFeeReminderNames,
  type FeeReminderRequest,
  type FeeReminderResponse,
} from "@/modules/ai/fee-reminder.schemas";
import { buildFeeReminderPrompt, FEE_REMINDER_INSTRUCTIONS } from "@/modules/ai/prompts/fee-reminder";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { listDefaulters, listTermOptions } from "@/modules/finance/queries";
import { getStudentProfile } from "@/modules/people/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lesson 9: always cap output (three short texts, ≤1.2k chars of JSON).
const MAX_OUTPUT_TOKENS = 1024;
const MS_PER_DAY = 86_400_000;
// Same zone the finance/lesson-plan pages use for "today".
const TZ = "Asia/Kolkata";

const firstName = (fullName: string | undefined): string | undefined => fullName?.trim().split(/\s+/)[0] || undefined;

export const POST = aiTaskRoute<FeeReminderRequest, FeeReminderResponse>({
  route: "fee-reminder-draft",
  schema: FeeReminderRequestSchema,
  maxBodyBytes: 8 * 1024,
  permission: "finance.structure.manage",
  capability: "fee_reminder_writer",
  run: async (ctx, input) => {
    const [defaulters, terms] = await Promise.all([listDefaulters(ctx, { termId: input.termId }), listTermOptions(ctx)]);
    const invoice = defaulters.find((d) => d.invoiceId === input.invoiceId);
    const termName = terms.find((t) => t.id === input.termId)?.label;
    const student = invoice && termName ? await getStudentProfile(ctx, invoice.studentId) : null;
    if (!invoice || !termName || !student) return fail("not_found", "Open invoice not found for this term.");

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    const daysOverdue = invoice.dueOn ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(invoice.dueOn)) / MS_PER_DAY)) : 0;

    const generated = await runStructured({
      ctx,
      feature: "fee_reminder_draft",
      schema: FeeReminderGenerationSchema,
      instructions: FEE_REMINDER_INSTRUCTIONS,
      prompt: buildFeeReminderPrompt({
        schoolName: ctx.institution.name,
        termName,
        amountDue: formatINR(Math.round(invoice.outstanding * 100)),
        dueOn: invoice.dueOn,
        daysOverdue,
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    // Guardians come primary-first (getStudentProfile orders by is_primary).
    const names = { student: firstName(student.firstName) ?? "your child", guardian: firstName(student.guardians[0]?.fullName) ?? "Parent" };
    const { data, provider, model, fallback } = generated.data;
    return ok({
      callScript: fillFeeReminderNames(data.callScript, names),
      sms: fillFeeReminderNames(data.sms, names),
      whatsapp: fillFeeReminderNames(data.whatsapp, names),
      provider,
      model,
      fallback,
    });
  },
});
