"use client";

// Answers about numbers get a chart drawn from the tool's own result, never from model text (owner,
// 2026-11-12: "things that can be explained better with graphs and visuals"). Horizontal bars as a
// list, so a screen reader reads the same numbers; at most 12 rows, largest first where order is free.
const DATA = /<data-[a-z0-9]+>([\s\S]*)<\/data-[a-z0-9]+>/i;

export interface ChartSpec {
  title: string;
  rows: { label: string; value: number; display: string }[];
  /** Bars share one colour unless a row is a warning (e.g. absent, below 70%). */
  tone?: "warn";
}

const rupees = (v: unknown): number => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0);
const top = <T,>(xs: T[], by: (x: T) => number, n = 12): T[] => [...xs].sort((a, b) => by(b) - by(a)).slice(0, n);
const GRADE_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2", "D", "E", "E1", "E2"];

/** The chart for one read tool's output, or null when a chart would not help. Pure. */
export function chartFromTool(toolType: string, output: unknown): ChartSpec | null {
  if (typeof output !== "string") return null;
  const m = DATA.exec(output);
  if (!m) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(m[1]!) as Record<string, unknown>;
  } catch {
    return null;
  }
  const name = toolType.replace(/^tool-/, "");
  if (name === "attendance_attendanceTodaySummary" && Array.isArray(data.byStatus) && (data.studentsMarked as number) > 0) {
    const rows = (data.byStatus as { status: string; students: number }[]).map((s) => ({ label: s.status, value: s.students, display: String(s.students) }));
    return { title: `Today's attendance (${data.percentage}%)`, rows };
  }
  if (name === "attendance_todayBySection" && Array.isArray(data.sections) && data.sections.length > 0) {
    const secs = data.sections as { section: string; absent: number; percentage: number }[];
    if (secs.length <= 12) return { title: "Attendance % by class", rows: secs.map((s) => ({ label: s.section, value: s.percentage, display: `${s.percentage}%` })) };
    return { title: "Most absent today", tone: "warn", rows: top(secs, (s) => s.absent).filter((s) => s.absent > 0).map((s) => ({ label: s.section, value: s.absent, display: `${s.absent} absent` })) };
  }
  if (name === "exams_examGradeDistribution" && data.distribution && typeof data.distribution === "object") {
    const d = data.distribution as Record<string, number>;
    const keys = Object.keys(d).sort((a, b) => (GRADE_ORDER.indexOf(a) + 99) % 99 - (GRADE_ORDER.indexOf(b) + 99) % 99 || a.localeCompare(b));
    return { title: `Grades in ${data.examName ?? "the exam"}`, rows: keys.map((k) => ({ label: k, value: d[k]!, display: String(d[k]) })) };
  }
  if (name === "exams_sectionScoreBands" && Array.isArray(data.sections) && data.sections.length > 0) {
    const secs = data.sections as { section: string; below: number; students: number }[];
    return { title: `Below ${data.threshold}% in ${data.exam}`, tone: "warn", rows: top(secs, (s) => s.below).map((s) => ({ label: s.section, value: s.below, display: `${s.below} of ${s.students}` })) };
  }
  if (name === "finance_termCollectionSummary" && data.collected !== undefined) {
    const collected = rupees(data.collected);
    const outstanding = rupees(data.outstanding);
    if (collected + outstanding === 0) return null;
    return { title: "Fees this term", rows: [{ label: "Collected", value: collected, display: String(data.collected) }, { label: "Outstanding", value: outstanding, display: String(data.outstanding) }] };
  }
  if (name === "people_enrolmentCounts" && Array.isArray(data.sections)) {
    const secs = (data.sections as { section: string; students: number }[]).filter((s) => s.students > 0);
    return secs.length > 1 && secs.length <= 12 ? { title: "Students per class", rows: secs.map((s) => ({ label: s.section, value: s.students, display: String(s.students) })) } : null;
  }
  return null;
}

export function OrbDataChart({ spec }: { spec: ChartSpec }) {
  const max = Math.max(1, ...spec.rows.map((r) => r.value));
  if (spec.rows.length === 0) return null;
  return (
    <figure className="space-y-1.5 rounded-xl border border-border bg-card p-3">
      <figcaption className="text-xs font-semibold">{spec.title}</figcaption>
      <ul className="space-y-1">
        {spec.rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground" title={r.label}>
              {r.label}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className={`block h-full rounded-full ${spec.tone === "warn" ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
            </span>
            <span className="tabular-nums">{r.display}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
