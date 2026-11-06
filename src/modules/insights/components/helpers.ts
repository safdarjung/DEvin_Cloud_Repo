// Pure UI helpers for the insights workspace (no server-only imports).
import type { InsightDomain, InsightSeverity, InsightStatus } from "@/modules/fabric/types";

export const INSIGHT_DOMAINS: readonly InsightDomain[] = [
  "attendance",
  "academics",
  "finance",
  "admissions",
  "operations",
  "wellbeing",
  "staff",
];

export const OPEN_STATUSES: readonly InsightStatus[] = ["new", "reviewing", "actioned"];

export const STATUS_TABS: readonly { key: string; label: string; statuses: readonly InsightStatus[] }[] = [
  { key: "open", label: "Open", statuses: OPEN_STATUSES },
  { key: "new", label: "New", statuses: ["new"] },
  { key: "reviewing", label: "Reviewing", statuses: ["reviewing"] },
  { key: "actioned", label: "Actioned", statuses: ["actioned"] },
  { key: "resolved", label: "Resolved", statuses: ["resolved"] },
  { key: "dismissed", label: "Dismissed", statuses: ["dismissed"] },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseStatusTab(raw: string | undefined): (typeof STATUS_TABS)[number] {
  return STATUS_TABS.find((t) => t.key === raw) ?? STATUS_TABS[0];
}

export function parseDomain(raw: string | undefined): InsightDomain | undefined {
  return INSIGHT_DOMAINS.find((d) => d === raw);
}

export function parseUuid(raw: string | undefined): string | undefined {
  return raw && UUID_RE.test(raw) ? raw : undefined;
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 3, warning: 2, watch: 1, info: 0 };

export function severityRank(s: InsightSeverity): number {
  return SEVERITY_RANK[s];
}

/** Severity desc, then confidence desc; stable for ties. Does not mutate. */
export function sortInsights<T extends { severity: InsightSeverity; confidence: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence);
}

export function confidencePct(c: number): number {
  return Math.round(Math.min(1, Math.max(0, c)) * 100);
}

export function insightHref(
  base: string,
  p: { status?: string; domain?: string; id?: string },
): string {
  const q = new URLSearchParams();
  if (p.status && p.status !== "open") q.set("status", p.status);
  if (p.domain) q.set("domain", p.domain);
  if (p.id) q.set("id", p.id);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
