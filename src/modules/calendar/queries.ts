import "server-only";
// M13-T10 — calendar.forRole read. RLS (0075) already hides staff-audience
// events from guardians/students; the institution_id/date filters below are
// defense in depth, same shape as every other queries.ts (mirrors
// src/modules/timetable/queries.ts). Lane B: no MOD `module` column in this
// worktree (see 20261028000075_operations.sql header) — nothing to declare
// here either.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { CalendarForRoleInput } from "./schemas";

const DEFAULT_WINDOW_DAYS = 90;

/** Institution-local calendar date — same approach as attendance/actions.ts's own `todayInTimezone`. */
function todayInInstitutionTimezone(ctx: TenantContext): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  const timeZone = locale.success ? locale.data.timezone : "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface CalendarEventRow {
  id: string;
  kind: "holiday" | "exam_week" | "ptm" | "event";
  title: string;
  description: string | null;
  startsOn: string;
  endsOn: string;
  audience: "all" | "staff";
}

/**
 * Events overlapping [from, to] (default: today .. today + 90 days in the
 * institution's timezone), ordered by startsOn. RLS narrows guardians/
 * students to audience 'all'.
 */
export async function calendarForRole(ctx: TenantContext, input: CalendarForRoleInput): Promise<CalendarEventRow[]> {
  const today = todayInInstitutionTimezone(ctx);
  const from = input.from ?? today;
  const to = input.to ?? addDays(today, DEFAULT_WINDOW_DAYS);

  const supabase = await createClient();
  let query = supabase
    .from("academic_calendar_events")
    .select("id, kind, title, description, starts_on, ends_on, audience")
    .eq("institution_id", ctx.institution.id)
    .lte("starts_on", to)
    .gte("ends_on", from)
    .order("starts_on", { ascending: true });
  if (input.kinds && input.kinds.length > 0) {
    query = query.in("kind", input.kinds);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind as CalendarEventRow["kind"],
    title: row.title,
    description: row.description,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    audience: row.audience as CalendarEventRow["audience"],
  }));
}
