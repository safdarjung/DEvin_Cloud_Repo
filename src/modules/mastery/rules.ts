// M20-T3 — pure mastery thresholds, risk/trend classification, gap & plan
// derivation. No side effects, no DB, no AI. Relative + .ts import: seed/job
// handler load this directly (mirrors src/modules/timetable/schemas.ts).
import type { Insight, InterventionPlan, StudentSuccessRow } from "../fabric/types.ts";

export const GAP_THRESHOLD = 0.6;
export const MIN_CONFIDENCE = 0.5;
export const LOW_MASTERY = 0.4;
export const CRITICAL_MASTERY = 0.25;
export const SUPPORT_GAP_UNITS = 3;
export const CRITICAL_GAP_UNITS = 6;
export const ATTENDANCE_WATCH_PCT = 75;
export const TREND_DELTA_PCT = 5;
export const MAX_PLAN_GAPS = 3;
export const DETECTOR_VERSION = "mastery_gap_v1";

export type Trend = "up" | "flat" | "down";
export type Risk = "none" | "watch" | "support";
export type MasteryGap = StudentSuccessRow["gaps"][number];
export interface MasteryStats {
  gapUnits: number;
  confidentUnits: number;
  meanScore: number | null;
}
export interface UnitScore {
  subject: string;
  topic: string;
  sequence: number;
  score: number;
  confidence: number;
}

export function masteryPct(score: number): number {
  return Math.round(score * 100);
}

export function gapsFrom(units: UnitScore[]): MasteryGap[] {
  return units
    .filter((u) => u.confidence >= MIN_CONFIDENCE && u.score < GAP_THRESHOLD)
    .sort((a, b) => a.score - b.score || a.subject.localeCompare(b.subject) || a.sequence - b.sequence)
    .map((u) => ({ subject: u.subject, topic: u.topic, mastery_pct: masteryPct(u.score) }));
}

export function trendFrom(percentages: number[]): Trend {
  if (percentages.length < 2) return "flat";
  const last = percentages[percentages.length - 1];
  const previous = percentages[percentages.length - 2];
  const delta = last - previous;
  if (delta >= TREND_DELTA_PCT) return "up";
  if (delta <= -TREND_DELTA_PCT) return "down";
  return "flat";
}

export function classifyStudent(
  stats: MasteryStats,
  context: { trend: Trend; attendancePct: number | null; hasActivePlan: boolean }
): { risk: Risk; flags: string[] } {
  const { gapUnits, confidentUnits, meanScore } = stats;
  const { trend, attendancePct, hasActivePlan } = context;
  const lowAttendance = attendancePct !== null && attendancePct < ATTENDANCE_WATCH_PCT;
  const lowMastery = meanScore !== null && meanScore < LOW_MASTERY;

  let risk: Risk;
  if (gapUnits >= SUPPORT_GAP_UNITS || lowMastery) {
    risk = "support";
  } else if (gapUnits >= 1 || trend === "down" || lowAttendance) {
    risk = "watch";
  } else {
    risk = "none";
  }

  const flags: string[] = [];
  if (gapUnits >= 1) flags.push(gapUnits === 1 ? "1 unit gap" : `${gapUnits} unit gaps`);
  if (lowMastery) flags.push("Low mastery");
  if (trend === "down") flags.push("Declining results");
  if (lowAttendance) flags.push("Attendance below 75%");
  if (confidentUnits === 0) flags.push("Low evidence");
  if (hasActivePlan) flags.push("Intervention active");

  return { risk, flags };
}

export function gapSeverity(stats: MasteryStats): "warning" | "critical" {
  const criticalMastery = stats.meanScore !== null && stats.meanScore < CRITICAL_MASTERY;
  return stats.gapUnits >= CRITICAL_GAP_UNITS || criticalMastery ? "critical" : "warning";
}

export function gapConfidence(stats: MasteryStats): number {
  return Math.round(Math.min(1, stats.confidentUnits / 6) * 100) / 100;
}

export function gapEvidence(stats: MasteryStats, gaps: MasteryGap[]): Insight["evidence"] {
  const evidence: Insight["evidence"] = [{ label: "Gap units", value: stats.gapUnits }];
  if (stats.meanScore !== null) {
    evidence.push({ label: "Overall mastery", value: Math.round(stats.meanScore * 100), unit: "%" });
  }
  evidence.push({ label: "Units assessed", value: stats.confidentUnits });
  for (const gap of gaps.slice(0, 5)) {
    evidence.push({ label: `${gap.subject} · ${gap.topic}`.slice(0, 120), value: gap.mastery_pct, unit: "%" });
  }
  return evidence;
}

export function gapPattern(stats: MasteryStats): string {
  const overall = stats.meanScore === null ? "n/a" : `${Math.round(stats.meanScore * 100)}%`;
  return `${stats.gapUnits} units below 60% mastery; overall ${overall}`;
}

function addDaysUTC(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function proposeIntervention(
  gaps: MasteryGap[],
  today: string
): { goal: string; steps: InterventionPlan["steps"]; reviewDate: string } {
  const k = Math.min(MAX_PLAN_GAPS, gaps.length);
  const steps: InterventionPlan["steps"] = [];
  for (let i = 1; i <= k; i++) {
    const gap = gaps[i - 1];
    const title = `Re-teach: ${gap.topic.slice(0, 80)} (${gap.subject})`.slice(0, 120);
    steps.push({ title, due: addDaysUTC(today, 7 * i), done: false });
  }
  const reviewDate = addDaysUTC(today, 7 * (k + 1));
  steps.push({ title: "Re-assess gap units", due: reviewDate, done: false });
  const goal = `Raise ${k} gap unit${k === 1 ? "" : "s"} to 60% mastery`;
  return { goal, steps, reviewDate };
}
