import "server-only";
// Helpdesk reads. RLS (0121) narrows rows: owner/principal/admin see every ticket, a raiser only their
// own (and the messages of those). institution_id filters are defense in depth.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { TicketListInput } from "./schemas";

export const HELPDESK_PAGE_SIZE = 25;

export interface TicketRow {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  dueAt: string;
  createdAt: string;
  raisedByName: string;
  assigneeStaffId: string | null;
  assigneeName: string | null;
}

export interface TicketPage {
  rows: TicketRow[];
  total: number;
  page: number;
  pageSize: number;
}

type Named = { full_name: string } | null;
const SELECT =
  "id, subject, category, priority, status, due_at, created_at, assignee_staff_id, raiser:profiles!helpdesk_tickets_raised_by_fkey(full_name), assignee:staff!helpdesk_tickets_assignee_staff_id_fkey(full_name)";

function toRow(r: {
  id: string; subject: string; category: string; priority: string; status: string; due_at: string; created_at: string;
  assignee_staff_id: string | null; raiser: unknown; assignee: unknown;
}): TicketRow {
  return {
    id: r.id,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: r.status,
    dueAt: r.due_at,
    createdAt: r.created_at,
    raisedByName: (r.raiser as Named)?.full_name ?? "Unknown",
    assigneeStaffId: r.assignee_staff_id,
    assigneeName: (r.assignee as Named)?.full_name ?? null,
  };
}

/** Tickets the caller can see (all for managers, own for raisers), newest first. Paged. */
export async function listTickets(ctx: TenantContext, input: TicketListInput = {}): Promise<TicketPage> {
  const supabase = await createClient();
  const page = Math.max(1, input.page ?? 1);
  const from = (page - 1) * HELPDESK_PAGE_SIZE;
  let q = supabase
    .from("helpdesk_tickets")
    .select(SELECT, { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .range(from, from + HELPDESK_PAGE_SIZE - 1);
  if (input.status) q = q.eq("status", input.status);
  if (input.priority) q = q.eq("priority", input.priority);
  if (input.overdue) q = q.in("status", ["open", "in_progress"]).lt("due_at", new Date().toISOString());
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []).map(toRow), total: count ?? 0, page, pageSize: HELPDESK_PAGE_SIZE };
}

export interface TicketMessage {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  mine: boolean;
  /** Written by the ticket's raiser (else by school staff); lets AI triage label sides by role, not name. */
  fromRaiser: boolean;
}

export interface TicketThread {
  ticket: TicketRow;
  /** Raiser's profile id (for raiserRoles); never rendered. */
  raisedBy: string;
  messages: TicketMessage[];
}

/** One ticket + its messages, or null when RLS hides it. */
export async function getThread(ctx: TenantContext, ticketId: string): Promise<TicketThread | null> {
  const supabase = await createClient();
  const { data: t, error } = await supabase
    .from("helpdesk_tickets")
    .select(`${SELECT}, raised_by` as const)
    .eq("institution_id", ctx.institution.id)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw error;
  if (!t) return null;
  const { data: msgs, error: mErr } = await supabase
    .from("helpdesk_messages")
    .select("id, body, created_at, author_id, author:profiles!helpdesk_messages_author_id_fkey(full_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (mErr) throw mErr;
  return {
    ticket: toRow(t),
    raisedBy: t.raised_by,
    messages: (msgs ?? []).map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      authorName: (m.author as Named)?.full_name ?? "Unknown",
      mine: m.author_id === ctx.user.id,
      fromRaiser: m.author_id === t.raised_by,
    })),
  };
}

/** The raiser's active roles here, sorted (name-free label for AI triage). RLS: managers read every membership. */
export async function raiserRoles(ctx: TenantContext, userId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return [...new Set((data ?? []).map((m) => m.role))].sort();
}

export interface HelpdeskCounts {
  open: number;
  overdue: number;
}

/** Name-free aggregates for the Orb/AI (§E): counts only. */
export async function ticketCounts(ctx: TenantContext): Promise<HelpdeskCounts> {
  const supabase = await createClient();
  const base = () => supabase.from("helpdesk_tickets").select("id", { count: "exact", head: true }).eq("institution_id", ctx.institution.id).in("status", ["open", "in_progress"]);
  const [open, overdue] = await Promise.all([base(), base().lt("due_at", new Date().toISOString())]);
  if (open.error) throw open.error;
  if (overdue.error) throw overdue.error;
  return { open: open.count ?? 0, overdue: overdue.count ?? 0 };
}

export interface AssigneeOption {
  id: string;
  label: string;
}

/** Active owner/principal/admin staff: the only valid assignees (definer enforces the same). */
export async function listAssignees(ctx: TenantContext): Promise<AssigneeOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("staff_id, staff:staff!inner(full_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .in("role", ["owner", "principal", "admin"])
    .not("staff_id", "is", null)
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((m) => ({ id: m.staff_id as string, label: (m.staff as unknown as Named)?.full_name ?? "Staff" }));
}
