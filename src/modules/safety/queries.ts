import "server-only";
// Safety reads (0129). RLS narrows every table: alerts by audience,
// acknowledgements to M (all) or own rows, headcounts to M or the teacher's
// sections. institution_id filters are defense in depth.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { getJobStatusByKey } from "@/modules/jobs/queries";
import { chunked, resolveSafetyAudience, type AudienceGroup } from "./recipients";
import type { SafetyAudience, SafetyKind } from "./schemas";

export const SAFETY_HISTORY_PAGE_SIZE = 20;
const ACTIVE_CAP = 50;
const PENDING_NAMES_CAP = 300;

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface SafetyAlertRow {
  id: string;
  kind: SafetyKind;
  title: string;
  message: string;
  audience: SafetyAudience;
  status: "active" | "closed";
  createdAt: string;
  closedAt: string | null;
  /** Targeted sections the caller can see (RLS: staff all, student/guardian only their own). */
  sectionLabels: string[];
  acknowledgedByMe: boolean;
}

export interface SafetyAlertList {
  active: SafetyAlertRow[];
  history: SafetyAlertRow[];
  historyTotal: number;
  page: number;
  pageSize: number;
}

const ALERT_COLUMNS =
  "id, kind, title, message, audience, status, created_at, closed_at, safety_alert_sections(class_section_id, class_sections(name, grades(code)))";

type AlertSelectRow = {
  id: string;
  kind: string;
  title: string;
  message: string;
  audience: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  safety_alert_sections: { class_sections: { name: string; grades: { code: string } | null } | null }[] | null;
};

function toAlert(r: AlertSelectRow, acked: Set<string>): SafetyAlertRow {
  return {
    id: r.id,
    kind: r.kind as SafetyKind,
    title: r.title,
    message: r.message,
    audience: r.audience as SafetyAudience,
    status: r.status as "active" | "closed",
    createdAt: r.created_at,
    closedAt: r.closed_at,
    sectionLabels: (r.safety_alert_sections ?? [])
      .map((s) => (s.class_sections ? `${s.class_sections.grades?.code ?? "?"}-${s.class_sections.name}` : null))
      .filter((l): l is string => l !== null)
      .sort(),
    acknowledgedByMe: acked.has(r.id),
  };
}

/** Alerts the caller can see: every active one, plus a page of closed history. Newest first. */
export async function listSafetyAlerts(ctx: TenantContext, page = 1): Promise<SafetyAlertList> {
  const supabase = await createClient();
  const from = (Math.max(1, page) - 1) * SAFETY_HISTORY_PAGE_SIZE;
  const [activeR, historyR] = await Promise.all([
    supabase
      .from("safety_alerts")
      .select(ALERT_COLUMNS)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(ACTIVE_CAP),
    supabase
      .from("safety_alerts")
      .select(ALERT_COLUMNS, { count: "exact" })
      .eq("institution_id", ctx.institution.id)
      .eq("status", "closed")
      .order("created_at", { ascending: false })
      .range(from, from + SAFETY_HISTORY_PAGE_SIZE - 1),
  ]);
  if (activeR.error) throw activeR.error;
  if (historyR.error) throw historyR.error;
  const activeRows = (activeR.data ?? []) as unknown as AlertSelectRow[];
  const historyRows = (historyR.data ?? []) as unknown as AlertSelectRow[];

  const ids = [...activeRows, ...historyRows].map((r) => r.id);
  const acked = new Set<string>();
  if (ids.length > 0) {
    // Own rows only: a manager reads every acknowledgement, so filter by user too.
    const { data, error } = await supabase
      .from("safety_acknowledgements")
      .select("alert_id")
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .in("alert_id", ids);
    if (error) throw error;
    for (const r of data ?? []) acked.add(r.alert_id);
  }

  return {
    active: activeRows.map((r) => toAlert(r, acked)),
    history: historyRows.map((r) => toAlert(r, acked)),
    historyTotal: historyR.count ?? 0,
    page: Math.max(1, page),
    pageSize: SAFETY_HISTORY_PAGE_SIZE,
  };
}

export interface SectionOption {
  id: string;
  label: string;
  sortKey: number;
}

type SectionSelectRow = { id: string; name: string; grades: { code: string; sort_key: number } | null };

function toSection(r: SectionSelectRow): SectionOption {
  return { id: r.id, label: `${r.grades?.code ?? "?"}-${r.name}`, sortKey: r.grades?.sort_key ?? 0 };
}

function bySection(a: SectionOption, b: SectionOption): number {
  return a.sortKey - b.sortKey || a.label.localeCompare(b.label);
}

/** Sections by id (any year), or the current academic year's sections when `ids` is omitted. Grade order. */
async function loadSections(supabase: Supabase, institutionId: string, ids?: readonly string[]): Promise<SectionOption[]> {
  const out: SectionOption[] = [];
  if (ids) {
    for (const part of chunked(ids)) {
      const { data, error } = await supabase
        .from("class_sections")
        .select("id, name, grades(code, sort_key)")
        .eq("institution_id", institutionId)
        .in("id", part);
      if (error) throw error;
      out.push(...((data ?? []) as unknown as SectionSelectRow[]).map(toSection));
    }
    return out.sort(bySection);
  }
  const { data: year, error: yearError } = await supabase
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .maybeSingle();
  if (yearError) throw yearError;
  if (!year) return [];
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, name, grades(code, sort_key)")
    .eq("institution_id", institutionId)
    .eq("academic_year_id", year.id)
    .limit(1000);
  if (error) throw error;
  return ((data ?? []) as unknown as SectionSelectRow[]).map(toSection).sort(bySection);
}

/** Current-year sections for the send form's audience picker. */
export async function safetySectionOptions(ctx: TenantContext): Promise<SectionOption[]> {
  return loadSections(await createClient(), ctx.institution.id);
}

export interface HeadcountEntry {
  presentCount: number;
  missingCount: number;
  note: string | null;
  updatedAt: string;
}

export interface BoardRow {
  sectionId: string;
  label: string;
  headcount: HeadcountEntry | null;
}

type HeadcountSelectRow = { class_section_id: string; present_count: number; missing_count: number; note: string | null; updated_at: string };

function toBoard(sections: SectionOption[], headcounts: HeadcountSelectRow[]): BoardRow[] {
  const bySectionId = new Map(headcounts.map((h) => [h.class_section_id, h]));
  const rows = sections.map((s) => {
    const h = bySectionId.get(s.id);
    return {
      sectionId: s.id,
      label: s.label,
      headcount: h ? { presentCount: h.present_count, missingCount: h.missing_count, note: h.note, updatedAt: h.updated_at } : null,
    };
  });
  // Not yet reported first; otherwise grade order (stable sort keeps it).
  return [...rows.filter((r) => !r.headcount), ...rows.filter((r) => r.headcount)];
}

async function alertHeader(supabase: Supabase, institutionId: string, alertId: string) {
  const { data, error } = await supabase
    .from("safety_alerts")
    .select("id, audience, status")
    .eq("institution_id", institutionId)
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  let sectionIds: string[] = [];
  if (data.audience === "sections") {
    const { data: rows, error: sError } = await supabase
      .from("safety_alert_sections")
      .select("class_section_id")
      .eq("institution_id", institutionId)
      .eq("alert_id", alertId);
    if (sError) throw sError;
    sectionIds = (rows ?? []).map((r) => r.class_section_id);
  }
  return { id: data.id, audience: data.audience as SafetyAudience, status: data.status, sectionIds };
}

// One load per request shared by the aggregate and the name list below.
const loadManagerState = cache(async (institutionId: string, alertId: string) => {
  const supabase = await createClient();
  const alert = await alertHeader(supabase, institutionId, alertId);
  if (!alert) return null;
  const [members, acks, headcountsR, sections] = await Promise.all([
    resolveSafetyAudience(supabase, institutionId, alert.audience, alert.sectionIds),
    (async () => {
      const ids = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("safety_acknowledgements")
          .select("user_id")
          .eq("institution_id", institutionId)
          .eq("alert_id", alertId)
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data ?? []) ids.add(r.user_id);
        if (!data || data.length < 1000) return ids;
      }
    })(),
    supabase
      .from("safety_headcounts")
      .select("class_section_id, present_count, missing_count, note, updated_at")
      .eq("institution_id", institutionId)
      .eq("alert_id", alertId)
      .limit(1000),
    loadSections(supabase, institutionId, alert.audience === "sections" ? alert.sectionIds : undefined),
  ]);
  if (headcountsR.error) throw headcountsR.error;
  return { alert, members, acks, headcounts: (headcountsR.data ?? []) as HeadcountSelectRow[], sections };
});

type GroupCounts = { total: number; staff: number; students: number; guardians: number };

function countGroups(groups: AudienceGroup[]): GroupCounts {
  return {
    total: groups.length,
    staff: groups.filter((g) => g === "staff").length,
    students: groups.filter((g) => g === "student").length,
    guardians: groups.filter((g) => g === "guardian").length,
  };
}

/** Name-free aggregate (§E): audience vs acknowledged counts, headcount totals and the per-section board. Managers (M) only — RLS gives others no acknowledgement totals. */
export interface SafetyAlertSummary {
  alertId: string;
  status: string;
  audience: GroupCounts;
  acknowledged: GroupCounts;
  headcount: { reportedSections: number; totalSections: number; present: number; missing: number };
  board: BoardRow[];
}

export async function safetyAlertSummary(ctx: TenantContext, alertId: string): Promise<SafetyAlertSummary | null> {
  const state = await loadManagerState(ctx.institution.id, alertId);
  if (!state) return null;
  const board = toBoard(state.sections, state.headcounts);
  const reported = board.filter((r) => r.headcount);
  return {
    alertId,
    status: state.alert.status,
    audience: countGroups(state.members.map((m) => m.group)),
    // Acknowledgements of people still in the audience, so x never exceeds y.
    acknowledged: countGroups(state.members.filter((m) => state.acks.has(m.userId)).map((m) => m.group)),
    headcount: {
      reportedSections: reported.length,
      totalSections: board.length,
      present: reported.reduce((s, r) => s + (r.headcount?.presentCount ?? 0), 0),
      missing: reported.reduce((s, r) => s + (r.headcount?.missingCount ?? 0), 0),
    },
    board,
  };
}

export type SafetyDelivery = "sent" | "queued" | "failed";

/** In-app delivery state of the alert's notify job, via the jobs owner query. Managers only (jobs RLS); null for anyone else. */
export async function safetyAlertDelivery(ctx: TenantContext, alertId: string): Promise<SafetyDelivery | null> {
  const status = await getJobStatusByKey(ctx, `safety_alert:${alertId}`);
  if (status === null) return null;
  if (status === "succeeded") return "sent";
  return status === "queued" || status === "running" ? "queued" : "failed";
}

export interface PendingMember {
  name: string;
  group: AudienceGroup;
}

/** Who has not acknowledged yet (names; managers only, never an AI aggregate). Staff first, then guardians, then students; capped. */
export async function safetyPendingAcknowledgements(
  ctx: TenantContext,
  alertId: string,
): Promise<{ total: number; shown: PendingMember[] } | null> {
  const state = await loadManagerState(ctx.institution.id, alertId);
  if (!state) return null;
  const order: Record<AudienceGroup, number> = { staff: 0, guardian: 1, student: 2 };
  const pending = state.members.filter((m) => !state.acks.has(m.userId)).sort((a, b) => order[a.group] - order[b.group]);
  const shown = pending.slice(0, PENDING_NAMES_CAP);

  const supabase = await createClient();
  const names = new Map<string, string>();
  const ids = (key: "staffId" | "guardianId" | "studentId") => shown.flatMap((m) => (m[key] ? [m[key] as string] : []));
  for (const part of chunked(ids("staffId"))) {
    const { data, error } = await supabase.from("staff").select("id, full_name").in("id", part);
    if (error) throw error;
    for (const r of data ?? []) names.set(r.id, r.full_name);
  }
  for (const part of chunked(ids("guardianId"))) {
    const { data, error } = await supabase.from("guardians").select("id, full_name").in("id", part);
    if (error) throw error;
    for (const r of data ?? []) names.set(r.id, r.full_name);
  }
  for (const part of chunked(ids("studentId"))) {
    const { data, error } = await supabase.from("students").select("id, first_name, last_name").in("id", part);
    if (error) throw error;
    for (const r of data ?? []) names.set(r.id, [r.first_name, r.last_name].filter(Boolean).join(" "));
  }

  return {
    total: pending.length,
    shown: shown
      .map((m) => ({ name: names.get(m.staffId ?? m.guardianId ?? m.studentId ?? "") ?? "Unnamed member", group: m.group }))
      .sort((a, b) => order[a.group] - order[b.group] || a.name.localeCompare(b.name)),
  };
}

/** Teacher view: the caller's own sections for this alert (class teacher or subject teacher; only targeted ones for a sections alert), with any headcount already recorded. */
export async function myHeadcountSections(ctx: TenantContext, alertId: string): Promise<BoardRow[]> {
  const staffId = ctx.membership.staffId;
  if (!staffId) return [];
  const supabase = await createClient();
  const alert = await alertHeader(supabase, ctx.institution.id, alertId);
  if (!alert) return [];
  const [classTeacherR, assignmentsR] = await Promise.all([
    supabase.from("class_sections").select("id").eq("institution_id", ctx.institution.id).eq("class_teacher_id", staffId),
    supabase.from("subject_assignments").select("class_section_id").eq("institution_id", ctx.institution.id).eq("teacher_id", staffId),
  ]);
  if (classTeacherR.error) throw classTeacherR.error;
  if (assignmentsR.error) throw assignmentsR.error;
  const taught = new Set([...(classTeacherR.data ?? []).map((r) => r.id), ...(assignmentsR.data ?? []).map((r) => r.class_section_id)]);
  // A sections alert: only its targeted sections; otherwise this year's sections.
  const sections =
    alert.audience === "sections"
      ? await loadSections(supabase, ctx.institution.id, alert.sectionIds.filter((id) => taught.has(id)))
      : (await loadSections(supabase, ctx.institution.id)).filter((s) => taught.has(s.id));
  if (sections.length === 0) return [];
  const { data, error } = await supabase
    .from("safety_headcounts")
    .select("class_section_id, present_count, missing_count, note, updated_at")
    .eq("institution_id", ctx.institution.id)
    .eq("alert_id", alertId)
    .in(
      "class_section_id",
      sections.map((s) => s.id),
    );
  if (error) throw error;
  return toBoard(sections, (data ?? []) as HeadcountSelectRow[]);
}
