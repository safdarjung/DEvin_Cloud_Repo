"use server";

// helpdesk.* (migration 0121). Raise/update only through the public definers; messages are
// RLS inserts of (institution_id, ticket_id, body). Safe for AI to draft (§E): helpdesk.message.reply
// only (a manager's reply a human saves); raise/update are never drafted.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import {
  RaiseTicketSchema,
  TicketMessageSchema,
  UpdateTicketSchema,
  type RaiseTicketInput,
  type TicketMessageInput,
  type UpdateTicketInput,
} from "./schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const raiseTicket = defineAction({
  name: "helpdesk.ticket.raise",
  module: "helpdesk",
  schema: RaiseTicketSchema,
  permission: "helpdesk.raise",
  // The definer writes its own audit row (ids only).
  handler: async ({ category, priority, subject, body }: RaiseTicketInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("raise_helpdesk_ticket", {
      p_institution_id: ctx.institution.id,
      p_category: category,
      p_priority: priority,
      p_subject: subject,
      p_body: body,
    });
    if (error) throwMapped(error);
    const r = data as { ticket_id: string; due_at: string };
    return { ticketId: r.ticket_id, dueAt: r.due_at };
  },
});

export const updateTicket = defineAction({
  name: "helpdesk.ticket.update",
  module: "helpdesk",
  schema: UpdateTicketSchema,
  permission: "helpdesk.manage",
  handler: async ({ ticketId, status, assigneeStaffId }: UpdateTicketInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_helpdesk_ticket", {
      p_institution_id: ctx.institution.id,
      p_ticket_id: ticketId,
      p_status: status,
      p_assignee_staff_id: assigneeStaffId as string,
    });
    if (error) throwMapped(error);
    const r = data as { ticket_id: string; status: string; assignee_staff_id: string | null };
    return { ticketId: r.ticket_id, status: r.status, assigneeStaffId: r.assignee_staff_id };
  },
});

async function addMessage(ctx: TenantContext, { ticketId, body }: TicketMessageInput, action: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("helpdesk_messages")
    .insert({ institution_id: ctx.institution.id, ticket_id: ticketId, body })
    .select("id")
    .single();
  if (error) {
    if ((error as { code?: string }).code === POSTGRES_RLS_VIOLATION) {
      throw new AppError("forbidden", "You cannot reply to this ticket. It may be closed.");
    }
    throwMapped(error);
  }
  await audit(ctx, { action, entityType: "helpdesk_messages", entityId: data.id, after: { ticketId } });
  return { id: data.id as string };
}

/** Raiser replies on their own ticket while it is not closed (RLS enforces both). */
export const addTicketMessage = defineAction({
  name: "helpdesk.message.add",
  module: "helpdesk",
  schema: TicketMessageSchema,
  permission: "helpdesk.raise",
  handler: (input: TicketMessageInput, ctx) => addMessage(ctx, input, "helpdesk.message.add"),
});

/** Manager reply on any ticket of the institution. */
export const replyToTicket = defineAction({
  name: "helpdesk.message.reply",
  module: "helpdesk",
  schema: TicketMessageSchema,
  permission: "helpdesk.manage",
  handler: (input: TicketMessageInput, ctx) => addMessage(ctx, input, "helpdesk.message.reply"),
});
