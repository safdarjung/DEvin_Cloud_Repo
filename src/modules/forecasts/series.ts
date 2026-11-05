// M21-T6 — series builders: RPC rows -> engine Period/Target. Pure, relative .ts imports.
// Date math on YYYY-MM-DD strings in UTC only (as_of is already local, lesson: no tz here).
import type { ForecastKind, ForecastUnit } from "./schemas.ts";
import type { Period, Target } from "./engine.ts";

export interface FeeSeriesRow {
  term_id: string;
  sequence: number;
  name: string;
  starts_on: string;
  window_end: string;
  collected_paise: number;
  billed_paise: number;
}

export interface AttendanceSeriesRow {
  class_section_id: string | null;
  points: { week_start: string; present: number; denominator: number }[];
}

export interface SeriesSpec {
  seriesKey: string;
  kind: ForecastKind;
  classSectionId: string | null;
  unit: ForecastUnit;
  k: number;
  periods: Period[];
  targets: Target[];
  billed: Record<string, number>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseISO(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function formatISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  return formatISO(new Date(parseISO(dateStr).getTime() + days * MS_PER_DAY));
}

function mondayOf(dateStr: string): string {
  const dow = (parseISO(dateStr).getUTCDay() + 6) % 7; // 0 = Monday ... 6 = Sunday
  return addDays(dateStr, -dow);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function isoWeek(mondayIso: string): { label: string; week: number } {
  const monday = parseISO(mondayIso);
  const thursday = new Date(monday.getTime() + 3 * MS_PER_DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = parseISO(`${year}-01-04`);
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4Dow * MS_PER_DAY);
  const week = Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * MS_PER_DAY)) + 1;
  return { label: `${year}-W${String(week).padStart(2, "0")}`, week };
}

export function buildFeeSeries(rows: FeeSeriesRow[], asOf: string): SeriesSpec | null {
  const periodRows = rows.filter((r) => r.window_end <= asOf);
  const targetRows = rows.filter((r) => r.window_end > asOf).slice(0, 3);
  if (periodRows.length === 0 || targetRows.length === 0) return null;

  const periods: Period[] = periodRows.map((r) => ({
    start: r.starts_on,
    label: r.name,
    value: r.collected_paise,
    seasonKey: `t${r.sequence}`,
  }));
  const targets: Target[] = targetRows.map((r) => ({
    start: r.starts_on,
    label: r.name,
    seasonKey: `t${r.sequence}`,
  }));
  const billed: Record<string, number> = {};
  for (const r of periodRows) billed[r.starts_on] = r.billed_paise;

  return {
    seriesKey: "fees:term",
    kind: "fee_collections_term",
    classSectionId: null,
    unit: "paise",
    k: 2,
    periods,
    targets,
    billed,
  };
}

export function attendanceWindow(asOf: string): { from: string; to: string } {
  const monday0 = mondayOf(asOf);
  return { from: addDays(monday0, -392), to: monday0 };
}

export function buildAttendanceSeries(rows: AttendanceSeriesRow[], asOf: string): SeriesSpec[] {
  const monday0 = mondayOf(asOf);
  const staleThreshold = addDays(monday0, -28);
  const targetStarts = [monday0, addDays(monday0, 7), addDays(monday0, 14)];
  const targets: Target[] = targetStarts.map((start) => {
    const { label, week } = isoWeek(start);
    return { start, label, seasonKey: `w${week}` };
  });

  const results: SeriesSpec[] = [];
  for (const row of rows) {
    const periodRows = row.points.filter((p) => p.denominator > 0);
    if (periodRows.length === 0) continue;
    const latestWeek = periodRows[periodRows.length - 1].week_start;
    if (latestWeek < staleThreshold) continue;

    const periods: Period[] = periodRows.map((p) => {
      const { label, week } = isoWeek(p.week_start);
      return {
        start: p.week_start,
        label,
        value: round2((100 * p.present) / p.denominator),
        seasonKey: `w${week}`,
      };
    });
    const seriesKey =
      row.class_section_id === null ? "attendance:school" : `attendance:section:${row.class_section_id}`;

    results.push({
      seriesKey,
      kind: "attendance_rate_week",
      classSectionId: row.class_section_id,
      unit: "pct",
      k: 4,
      periods,
      targets,
      billed: {},
    });
  }
  return results;
}

export function historyEvidence(
  spec: SeriesSpec,
): { start: string; label: string; value: number; billed?: number }[] {
  return spec.periods.slice(-6).map((p) => {
    const billed = spec.billed[p.start];
    return billed === undefined
      ? { start: p.start, label: p.label, value: p.value }
      : { start: p.start, label: p.label, value: p.value, billed };
  });
}
