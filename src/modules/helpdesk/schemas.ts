// Helpdesk (features-18 #12) — Zod schemas + SLA helper. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const HELPDESK_CATEGORIES = ["academics", "fees", "transport", "technical", "facilities", "other"] as const;
export const HELPDESK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const HELPDESK_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export const RaiseTicketSchema = z
  .object({
    category: z.enum(HELPDESK_CATEGORIES),
    priority: z.enum(HELPDESK_PRIORITIES),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();
export type RaiseTicketInput = z.infer<typeof RaiseTicketSchema>;

/** Sets BOTH fields (definer contract): send the current value for the one you are not changing. null = unassigned. */
export const UpdateTicketSchema = z
  .object({ ticketId: uuid, status: z.enum(HELPDESK_STATUSES), assigneeStaffId: uuid.nullable() })
  .strict();
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

export const TicketMessageSchema = z.object({ ticketId: uuid, body: z.string().trim().min(1).max(4000) }).strict();
export type TicketMessageInput = z.infer<typeof TicketMessageSchema>;

export const TicketListSchema = z
  .object({
    status: z.enum(HELPDESK_STATUSES).optional(),
    priority: z.enum(HELPDESK_PRIORITIES).optional(),
    overdue: z.boolean().optional(),
    page: z.number().int().min(1).optional(),
  })
  .strict();
export type TicketListInput = z.infer<typeof TicketListSchema>;

export const TicketThreadSchema = z.object({ ticketId: uuid }).strict();

export type SlaState = "on_time" | "due_soon" | "overdue" | "done";
const DUE_SOON_MS = 4 * 60 * 60 * 1000;

/** Resolved/closed tickets are "done"; otherwise compare due_at to now (due soon = within 4h). */
export function slaState(status: string, dueAt: string, now: Date = new Date()): SlaState {
  if (status === "resolved" || status === "closed") return "done";
  const left = new Date(dueAt).getTime() - now.getTime();
  if (left < 0) return "overdue";
  return left <= DUE_SOON_MS ? "due_soon" : "on_time";
}
