// features-18 §C #17 — /api/ai/fee-reminder-draft. The model writes
// `{studentName}` / `{guardianName}` placeholders; the route fills in first
// names afterwards, so no name crosses the AI boundary. Lesson 9: ≤500 chars.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const FeeReminderRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    invoiceId: uuid,
    // The defaulters page's term: the invoice is re-read from that term's open invoices.
    termId: uuid,
  })
  .strict();
export type FeeReminderRequest = z.infer<typeof FeeReminderRequestSchema>;

export const FeeReminderGenerationSchema = z
  .object({
    callScript: z.string().trim().min(1).max(500),
    sms: z.string().trim().min(1).max(160),
    whatsapp: z.string().trim().min(1).max(500),
  })
  .strict();
export type FeeReminderGeneration = z.infer<typeof FeeReminderGenerationSchema>;

export interface FeeReminderResponse extends FeeReminderGeneration {
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}

export function fillFeeReminderNames(text: string, names: { student: string; guardian: string }): string {
  return text.split("{studentName}").join(names.student).split("{guardianName}").join(names.guardian);
}
