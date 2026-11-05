// M19 rulings: Signals table + "Common". Fixed catalog of 11 signals, grouped into
// 8 detector files/modules. `import type` only — this file has no runtime deps.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { ModuleKey } from "@/lib/modules/catalog";
import type { InsightDomain, InsightKind, InsightSeverity } from "@/modules/fabric/types";

export type SignalKey =
  | "attendance.section_drop"
  | "attendance.student_drop"
  | "academics.marks_decline"
  | "academics.missing_work"
  | "academics.awaiting_review"
  | "finance.overdue_growth"
  | "finance.concession_spike"
  | "admissions.stage_dwell"
  | "staff.workload"
  | "operations.room_capacity"
  | "operations.room_pressure";

export type DetectorKey =
  | "attendance"
  | "marks"
  | "submissions"
  | "fees"
  | "admissions"
  | "workload"
  | "timetable-conflicts"
  | "resource-shortage";

// DB check `insights.reviewer_role` (rulings, Tables).
export type ReviewerRole = "owner" | "principal" | "admin" | "admissions" | "accountant" | "exam_controller";

// DB check `insights.entity_type` (rulings, Tables).
export type InsightEntityType = "section" | "student" | "staff" | "route" | "fee_structure" | "department";

export const SIGNALS = {
  "attendance.section_drop": {
    domain: "attendance",
    kind: "diagnostic",
    reviewerRole: "principal",
    why: "A section's attendance fell sharply against its own recent baseline.",
  },
  "attendance.student_drop": {
    domain: "attendance",
    kind: "diagnostic",
    reviewerRole: "principal",
    why: "A student's attendance dropped well below their own recent baseline.",
  },
  "academics.marks_decline": {
    domain: "academics",
    kind: "diagnostic",
    reviewerRole: "exam_controller",
    why: "A student's marks fell sharply between the last two published exams.",
  },
  "academics.missing_work": {
    domain: "academics",
    kind: "descriptive",
    reviewerRole: "principal",
    why: "A student is missing most of the assignments due in the last 4 weeks.",
  },
  "academics.awaiting_review": {
    domain: "academics",
    kind: "descriptive",
    reviewerRole: "principal",
    why: "A section has a backlog of submissions still waiting for feedback.",
  },
  "finance.overdue_growth": {
    domain: "finance",
    kind: "descriptive",
    reviewerRole: "accountant",
    why: "Overdue fee balances grew sharply over the last 4 weeks.",
  },
  "finance.concession_spike": {
    domain: "finance",
    kind: "diagnostic",
    reviewerRole: "principal",
    approvalRequired: true,
    why: "Fee concessions this period are far above the usual run rate.",
  },
  "admissions.stage_dwell": {
    domain: "admissions",
    kind: "diagnostic",
    reviewerRole: "admissions",
    why: "Several admissions items have sat in one stage far longer than usual.",
  },
  "staff.workload": {
    domain: "staff",
    kind: "descriptive",
    reviewerRole: "principal",
    why: "A teacher's weekly timetable load is above the school's limit.",
  },
  "operations.room_capacity": {
    domain: "operations",
    kind: "descriptive",
    reviewerRole: "admin",
    why: "A section is scheduled into rooms smaller than its own strength.",
  },
  "operations.room_pressure": {
    domain: "operations",
    kind: "diagnostic",
    reviewerRole: "admin",
    why: "Many rooms are booked near full, with little slack left in the week.",
  },
} as const satisfies Record<
  SignalKey,
  { domain: InsightDomain; kind: InsightKind; reviewerRole: ReviewerRole; approvalRequired?: true; why: string }
>;

// Snake_case shape of a `record_insights` row (rulings, Writer + T2 Tables).
export interface InsightCandidate {
  signal: SignalKey;
  detector_version: number;
  dedupe_key: string;
  domain: InsightDomain;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  pattern: string;
  evidence: { label: string; value: number; unit?: string }[];
  sources: string[];
  date_from: string;
  date_to: string;
  confidence: number;
  factors: { label: string; weight: number }[];
  reviewer_role: ReviewerRole;
  recommended_actions: string[];
  approval_required: boolean;
  entity_type: InsightEntityType | null;
  entity_id: string | null;
  entity_label: string | null;
  class_section_id: string | null;
}

/** Fills domain/kind/reviewer_role/factors/dedupe_key/approval_required; slices title/pattern. */
export function makeCandidate(
  signal: SignalKey,
  version: number,
  fields: {
    severity: InsightSeverity;
    title: string;
    pattern: string;
    evidence: { label: string; value: number; unit?: string }[];
    sources: string[];
    date_from: string;
    date_to: string;
    confidence: number;
    recommended_actions: string[];
    entity_type: InsightEntityType | null;
    entity_id: string | null;
    entity_label: string | null;
    class_section_id: string | null;
    window: string;
  },
): InsightCandidate {
  const def: { domain: InsightDomain; kind: InsightKind; reviewerRole: ReviewerRole; approvalRequired?: true; why: string } =
    SIGNALS[signal];
  const entityKey = fields.entity_type ?? "school";
  const idKey = fields.entity_id ?? "-";
  return {
    signal,
    detector_version: version,
    dedupe_key: `${signal}:${entityKey}:${idKey}:${fields.window}`,
    domain: def.domain,
    kind: def.kind,
    severity: fields.severity,
    title: fields.title.slice(0, 120),
    pattern: fields.pattern.slice(0, 300),
    evidence: fields.evidence,
    sources: fields.sources,
    date_from: fields.date_from,
    date_to: fields.date_to,
    confidence: fields.confidence,
    factors: [],
    reviewer_role: def.reviewerRole,
    recommended_actions: fields.recommended_actions,
    approval_required: fields.severity === "critical" || def.approvalRequired === true,
    entity_type: fields.entity_type,
    entity_id: fields.entity_id,
    entity_label: fields.entity_label,
    class_section_id: fields.class_section_id,
  };
}

/** ISO-8601 week, e.g. "2026-W44". UTC date math. */
export function isoWeekKey(asOf: string): string {
  const parsed = new Date(`${asOf}T00:00:00Z`);
  const date = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // Mon=1 .. Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** `asOf + n` days, UTC date math, returned as "YYYY-MM-DD". */
export function addDays(asOf: string, n: number): string {
  const date = new Date(`${asOf}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Clamps to [0.05, 0.95] at 2 dp. */
export function confidence(x: number): number {
  return Math.round(Math.min(0.95, Math.max(0.05, x)) * 100) / 100;
}

/** Percentage at 1 dp, or null when the denominator is 0. */
export function pct(num: number, den: number): number | null {
  if (den === 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

// Severity rank, high to low — cap order and derived default order both use it.
export const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 3,
  warning: 2,
  watch: 1,
  info: 0,
};

/** Caps each signal's candidates at `max`, keeping severity desc, confidence desc, dedupe_key asc. */
export function capPerSignal(candidates: InsightCandidate[], max = 20): InsightCandidate[] {
  const bySignal = new Map<SignalKey, InsightCandidate[]>();
  for (const c of candidates) {
    const group = bySignal.get(c.signal);
    if (group) group.push(c);
    else bySignal.set(c.signal, [c]);
  }
  const result: InsightCandidate[] = [];
  for (const group of bySignal.values()) {
    const ranked = [...group].sort((a, b) => {
      if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
        return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      }
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.dedupe_key < b.dedupe_key ? -1 : a.dedupe_key > b.dedupe_key ? 1 : 0;
    });
    result.push(...ranked.slice(0, max));
  }
  return result;
}

export interface DetectorInput {
  institutionId: string;
  asOf: string;
  settings: Record<string, unknown>;
}

export interface Detector {
  key: DetectorKey;
  module: ModuleKey;
  version: number;
  run(admin: SupabaseClient<Database>, input: DetectorInput): Promise<InsightCandidate[]>;
}
