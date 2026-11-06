// M25-T2 — pure briefing composer: recipes (which registered queries feed a
// role's brief), item texts, and the rules headline. No I/O, no
// "server-only" (T4 calls this after it has already fetched every source
// with the caller's own RLS client; other modules import only its types).
// M16 (dashboard.*) and M19 (insights.*, core.approvals.pending) result
// shapes are read from `data: unknown` via local type guards below — this
// module does not depend on those modules' exported types, only on the
// source's documented JSON shape (06-backend-packets/M25-tasks.md rulings).
import type { Role } from "@/lib/auth/permissions";
import type { DailyBrief, BriefingSource, PriorityAction, RiskIndicator } from "@/modules/fabric/types";
import type { CalendarEventRow } from "@/modules/calendar/queries";
import type { ExamScheduleRow } from "@/modules/exams/schedule.queries";

export type BriefRole = "principal" | "admin" | "accountant" | "admissions" | "teacher";

export const BRIEF_ROLE: Readonly<Partial<Record<Role, BriefRole>>> = {
  owner: "principal",
  principal: "principal",
  admin: "admin",
  accountant: "accountant",
  admissions: "admissions",
  teacher: "teacher",
};

export const BRIEF_ROLE_LABEL: Readonly<Record<BriefRole, string>> = {
  principal: "Principal",
  admin: "Admin",
  accountant: "Finance",
  admissions: "Admissions",
  teacher: "Teacher",
};

export interface BriefingSourceResult extends BriefingSource {
  data: unknown;
}

type Item = DailyBrief["items"][number];

const ATTENDANCE_TREND_DAYS = 14;
const WEEKLY_ATTENDANCE_DAYS = 7;
const CALENDAR_WINDOW_DAYS = 6; // today .. today + 6 ("in7", a 7-day window)
const MAX_ITEMS = 10;
const MAX_ITEM_CHARS = 200;
const MONDAY = 1;

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Recipe: the registered queries (name + params) a brief role's generator calls. */
export function briefingSources(role: BriefRole, today: string, weekday: number): BriefingSource[] {
  const in7 = addDays(today, CALENDAR_WINDOW_DAYS);
  const isMonday = weekday === MONDAY;

  switch (role) {
    case "principal":
    case "admin": {
      const sources: BriefingSource[] = [
        { query: "dashboard.attendanceTrend", params: { days: ATTENDANCE_TREND_DAYS } },
        { query: "core.approvals.pending", params: {} },
        { query: "dashboard.finance", params: {} },
        { query: "dashboard.admissions", params: {} },
        { query: "dashboard.operations", params: {} },
        { query: "insights.priorityActions", params: {} },
      ];
      if (isMonday) {
        sources.push(
          { query: "dashboard.attendanceTrend", params: { days: WEEKLY_ATTENDANCE_DAYS } },
          { query: "insights.riskIndicators", params: {} },
        );
      }
      return sources;
    }
    case "accountant":
      return [
        { query: "dashboard.finance", params: {} },
        { query: "core.approvals.pending", params: {} },
        { query: "insights.priorityActions", params: {} },
      ];
    case "admissions":
      return [
        { query: "dashboard.admissions", params: {} },
        { query: "core.approvals.pending", params: {} },
        { query: "insights.priorityActions", params: {} },
        { query: "calendar.forRole", params: { from: today, to: in7 } },
      ];
    case "teacher":
      return [
        { query: "calendar.forRole", params: { from: today, to: in7 } },
        { query: "exams.schedule", params: { from: today, to: in7 } },
      ];
  }
}

// ---------------------------------------------------------------- helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function find(
  results: readonly BriefingSourceResult[],
  query: string,
  params?: Record<string, unknown>,
): unknown {
  const match = results.find((r) => r.query === query && (params === undefined || sameParams(r.params, params)));
  return match?.data;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function truncateItem(item: Item): Item {
  if (item.text.length <= MAX_ITEM_CHARS) return item;
  return { ...item, text: `${item.text.slice(0, MAX_ITEM_CHARS - 1)}…` };
}

/** "d MMM" / "EEE d MMM" in en-IN, parsing a YYYY-MM-DD date as UTC midnight (rulings "Dates"). */
function formatDate(dateIso: string, withWeekday: boolean): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-IN", {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(date);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const day = byType.get("day") ?? "";
  const month = byType.get("month") ?? "";
  const weekday = byType.get("weekday");
  return withWeekday && weekday ? `${weekday} ${day} ${month}` : `${day} ${month}`;
}

// ---------------------------------------------------------------- item builders
// Each source shape below is read from `unknown` per the rulings' documented
// JSON (M16 dashboard.* / M19 insights.*, core.approvals.pending types are
// not imported — see file header).

function approvalsItem(results: readonly BriefingSourceResult[], slug: string): Item | null {
  const data = find(results, "core.approvals.pending");
  if (!Array.isArray(data)) return null;
  const n = data.filter((row) => isRecord(row) && row.kind !== "agent_run").length;
  if (n === 0) return null;
  return { text: `${pluralize(n, "item")} awaiting approval.`, href: `/${slug}/dashboard` };
}

interface TrendPointLike {
  label: string;
  value: number;
}

function isTrendPoints(data: unknown): data is TrendPointLike[] {
  return Array.isArray(data) && data.every((p) => isRecord(p) && typeof p.label === "string" && typeof p.value === "number");
}

function attendanceItem(results: readonly BriefingSourceResult[], slug: string): Item | null {
  const data = find(results, "dashboard.attendanceTrend", { days: ATTENDANCE_TREND_DAYS });
  if (!isTrendPoints(data) || data.length === 0) return null;
  const last = data[data.length - 1];
  const before = data.slice(Math.max(0, data.length - 1 - 7), data.length - 1);

  let comparison = "";
  if (before.length >= 3) {
    const delta = round1(last.value - mean(before.map((p) => p.value)));
    comparison =
      Math.abs(delta) < 0.5
        ? `, in line with the previous ${before.length} school days`
        : `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} pts on the previous ${before.length} school days`;
  }
  return { text: `Attendance on ${last.label}: ${last.value}%${comparison}.`, href: `/${slug}/attendance` };
}

function insightsItems(results: readonly BriefingSourceResult[]): Item[] {
  const data = find(results, "insights.priorityActions");
  if (!Array.isArray(data)) return [];
  return (data as PriorityAction[]).slice(0, 2).map((row) => ({
    text: `Review: ${row.title}`,
    insight_id: row.id,
    href: row.href,
  }));
}

interface FinanceDashboardLike {
  collections: { collectedPaise: number; duePaise: number; overdue: unknown[] };
}

function isFinanceDashboard(data: unknown): data is FinanceDashboardLike {
  if (!isRecord(data) || !isRecord(data.collections)) return false;
  const c = data.collections;
  return typeof c.collectedPaise === "number" && typeof c.duePaise === "number" && Array.isArray(c.overdue);
}

function feesItem(results: readonly BriefingSourceResult[], slug: string): Item | null {
  const data = find(results, "dashboard.finance");
  if (!isFinanceDashboard(data)) return null;
  const { collectedPaise, duePaise, overdue } = data.collections;
  if (!(duePaise > 0)) return null;

  const pct = Math.floor((collectedPaise * 1000) / duePaise) / 10;
  const toRupees = (paise: number) => Math.floor(paise / 100).toLocaleString("en-IN");
  let overdueClause = "";
  if (overdue.length > 0) {
    const n = overdue.length === 10 ? "10 or more" : String(overdue.length);
    const word = overdue.length === 1 ? "invoice" : "invoices";
    overdueClause = `; ${n} ${word} overdue`;
  }
  return {
    text: `Fees this term: ${pct}% collected (₹${toRupees(collectedPaise)} of ₹${toRupees(duePaise)})${overdueClause}.`,
    href: `/${slug}/finance`,
  };
}

interface AdmissionsDashboardLike {
  funnel: { enquiryStages: Record<string, number> };
  applicationStatuses: Record<string, number>;
}

function isAdmissionsDashboard(data: unknown): data is AdmissionsDashboardLike {
  if (!isRecord(data) || !isRecord(data.funnel) || !isRecord(data.applicationStatuses)) return false;
  return isRecord(data.funnel.enquiryStages);
}

function admissionsItem(results: readonly BriefingSourceResult[], slug: string): Item | null {
  const data = find(results, "dashboard.admissions");
  if (!isAdmissionsDashboard(data)) return null;
  const open = Object.values(data.funnel.enquiryStages).reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
  const statuses = data.applicationStatuses;
  const inProgress = (["submitted", "under_review", "interaction_scheduled", "offered"] as const).reduce(
    (sum, key) => sum + (typeof statuses[key] === "number" ? statuses[key] : 0),
    0,
  );
  return {
    text: `Admissions: ${open} open enquiries, ${inProgress} applications in progress.`,
    href: `/${slug}/admissions`,
  };
}

interface OperationsDashboardLike {
  staffToday: { onLeave: number | null; absent: number | null };
  coverNeeded: unknown[];
  openMaintenance: unknown[];
  upcomingEvents: { title: string; startsOn: string; kind?: string }[];
}

function isOperationsDashboard(data: unknown): data is OperationsDashboardLike {
  return (
    isRecord(data) &&
    isRecord(data.staffToday) &&
    Array.isArray(data.coverNeeded) &&
    Array.isArray(data.openMaintenance) &&
    Array.isArray(data.upcomingEvents)
  );
}

function staffItem(results: readonly BriefingSourceResult[]): Item | null {
  const data = find(results, "dashboard.operations");
  if (!isOperationsDashboard(data)) return null;
  const { onLeave, absent } = data.staffToday;
  const cover = data.coverNeeded.length;
  const hasSignal = (onLeave ?? 0) > 0 || (absent ?? 0) > 0 || cover > 0;
  if (!hasSignal) return null;

  const lead: string[] = [];
  if (onLeave !== null) lead.push(`${onLeave} on leave`);
  if (absent !== null) lead.push(`${absent} absent`);
  const coverClause = `${cover} period${cover === 1 ? "" : "s"} need cover`;
  const text = lead.length > 0 ? `Staff today: ${lead.join(", ")}; ${coverClause}.` : `Staff today: ${coverClause}.`;
  return { text };
}

function maintenanceItem(results: readonly BriefingSourceResult[]): Item | null {
  const data = find(results, "dashboard.operations");
  if (!isOperationsDashboard(data)) return null;
  const m = data.openMaintenance.length;
  if (m === 0) return null;
  return { text: `${pluralize(m, "open maintenance request")}.` };
}

function eventText(title: string, dateIso: string, kind?: string): string {
  const prefix = kind === "holiday" ? "Holiday: " : "";
  return `${prefix}${cut(title, 80)} on ${formatDate(dateIso, false)}`;
}

function eventsItems(results: readonly BriefingSourceResult[]): Item[] {
  const operations = find(results, "dashboard.operations");
  if (isOperationsDashboard(operations)) {
    const first = operations.upcomingEvents[0];
    return first ? [{ text: eventText(first.title, first.startsOn, first.kind) }] : [];
  }
  const calendar = find(results, "calendar.forRole");
  if (Array.isArray(calendar)) {
    return (calendar as CalendarEventRow[])
      .slice(0, 3)
      .map((row) => ({ text: eventText(row.title, row.startsOn, row.kind) }));
  }
  return [];
}

function examsItem(results: readonly BriefingSourceResult[]): Item | null {
  const data = find(results, "exams.schedule");
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data as ExamScheduleRow[];
  const first = rows[0];
  return {
    text: `${pluralize(rows.length, "exam paper")} in the next 7 days; first: ${first.title} ${first.subject} on ${formatDate(first.date, false)}.`,
  };
}

function weekAttendanceItem(results: readonly BriefingSourceResult[]): Item | null {
  const weekly = find(results, "dashboard.attendanceTrend", { days: WEEKLY_ATTENDANCE_DAYS });
  const full = find(results, "dashboard.attendanceTrend", { days: ATTENDANCE_TREND_DAYS });
  if (!isTrendPoints(weekly) || weekly.length === 0 || !isTrendPoints(full)) return null;

  const weekMean = round1(mean(weekly.map((p) => p.value)));
  const before = full.slice(0, Math.max(0, full.length - weekly.length));
  let comparison = "";
  if (before.length >= 3) {
    const delta = round1(weekMean - mean(before.map((p) => p.value)));
    comparison = ` (${delta >= 0 ? "up" : "down"} ${Math.abs(delta)} pts on the week before)`;
  }
  return { text: `Last 7 days: attendance averaged ${weekMean}%${comparison}.` };
}

function weekInsightsItem(results: readonly BriefingSourceResult[]): Item | null {
  const data = find(results, "insights.riskIndicators");
  if (!Array.isArray(data)) return null;
  const rising = (data as RiskIndicator[]).filter((row) => row.trend === "up");
  if (rising.length === 0) return null;
  return { text: `Insights rising this week: ${rising.map((r) => r.label).join(", ")}.` };
}

// ---------------------------------------------------------------- headline + compose

function headline(role: BriefRole, today: string, isMonday: boolean): string {
  const base = `${BRIEF_ROLE_LABEL[role]} briefing · ${formatDate(today, true)}`;
  const weekly = isMonday && (role === "principal" || role === "admin") ? " · week in review" : "";
  return `${base}${weekly}`;
}

export function composeBriefing(input: {
  role: BriefRole;
  slug: string;
  today: string;
  weekday: number;
  results: readonly BriefingSourceResult[];
}): { headline: string; items: DailyBrief["items"]; sources: BriefingSource[] } {
  const { role, slug, today, weekday, results } = input;
  const isMonday = weekday === MONDAY;

  const candidates: (Item | null)[] = [
    ...(isMonday ? [weekAttendanceItem(results), weekInsightsItem(results)] : []),
    approvalsItem(results, slug),
    attendanceItem(results, slug),
    ...insightsItems(results),
    feesItem(results, slug),
    admissionsItem(results, slug),
    staffItem(results),
    maintenanceItem(results),
    ...eventsItems(results),
    examsItem(results),
  ];

  const items = candidates
    .filter((item): item is Item => item !== null)
    .slice(0, MAX_ITEMS)
    .map(truncateItem);

  return {
    headline: headline(role, today, isMonday),
    items,
    sources: results.slice(0, 20).map(({ query, params }) => ({ query, params })),
  };
}
