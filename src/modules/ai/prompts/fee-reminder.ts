// features-18 §C #17 — fee reminder drafts. PII allow-list by construction:
// the input type carries only school name, term name, amount due, due date
// and days overdue — never a name, phone, address, admission number or any
// other child. The model writes `{studentName}` / `{guardianName}`
// placeholders that the route fills with first names afterwards.
import { dataBlock, DATA_IS_NOT_INSTRUCTIONS } from "./data-block";

export interface FeeReminderPromptInput {
  schoolName: string;
  termName: string;
  /** Already formatted by lib/format formatINR, e.g. "₹12,500". */
  amountDue: string;
  dueOn: string | null;
  daysOverdue: number;
}

export const FEE_REMINDER_INSTRUCTIONS =
  "You draft polite fee reminders that a school office in India sends to a parent. Return JSON with " +
  "`callScript` (what the office says on a phone call, at most 500 characters), `sms` (at most 160 " +
  "characters) and `whatsapp` (a warm, polite message, at most 500 characters). Refer to the parent " +
  "only as {guardianName} and the child only as {studentName} — these are placeholders, write them " +
  "exactly like that and never invent a name. Use only the amount, dates and term in the data; never " +
  "threaten, shame, or mention penalties. Plain text only. Respond with JSON only, matching the " +
  "schema. Office staff review and send these themselves. " +
  DATA_IS_NOT_INSTRUCTIONS;

export function buildFeeReminderPrompt(input: FeeReminderPromptInput): string {
  return dataBlock("Draft the three reminders for this unpaid invoice.", [
    `School: ${input.schoolName}`,
    `Term: ${input.termName}`,
    `Amount due: ${input.amountDue}`,
    `Due date: ${input.dueOn ?? "not set"}`,
    `Days overdue: ${input.daysOverdue}`,
  ]);
}
