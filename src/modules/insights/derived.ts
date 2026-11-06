import "server-only";
// M19-T19 — derived views over insights, per rulings "Derived". Pure mappers
// (toPriorityActions/toRiskIndicators/toInsightCards) take already-fetched
// rows so they're unit-testable without a DB; the async wrappers fetch via
// ./queries.ts (RLS does the real narrowing, same as every other
// queries.ts) and supply `now`.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { AIInsightCardProps } from "@/components/widgets/ai-insight-card";
import type { Insight, InsightSeverity, PriorityAction, RiskIndicator } from "@/modules/fabric/types";
import { addDays, SEVERITY_RANK, SIGNALS, type SignalKey } from "./signals";
import { listInsights } from "./queries";
import type { InsightCardsInput } from "./schemas";

const DAY_MS = 24 * 60 * 60 * 1000;

const REVIEWER_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  principal: "Principal",
  admin: "Admin",
  admissions: "Admissions",
  accountant: "Accountant",
  exam_controller: "Exam controller",
};

const SLA_DAYS: Record<InsightSeverity, number> = {
  critical: 1,
  warning: 3,
  watch: 7,
  info: 14,
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Default order (rulings, Derived): severity rank desc, confidence desc, created_at asc. */
function defaultOrder(a: Insight, b: Insight): number {
  if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

function insightHref(slug: string, id: string): string {
  return `/${slug}/fabric/insights?id=${id}`;
}

/**
 * At most 8 rows, from `new|reviewing` insights only (rulings, PriorityAction).
 * `now` isn't needed for `due` (= created date + SLA) — kept for signature
 * symmetry with toRiskIndicators; a pure mapper shouldn't call Date.now().
 */
export function toPriorityActions(rows: Insight[], slug: string, now: Date): PriorityAction[] {
  void now;
  return rows
    .filter((r) => r.status === "new" || r.status === "reviewing")
    .sort(defaultOrder)
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: row.title,
      why: row.explanation?.why ?? row.pattern,
      href: insightHref(slug, row.id),
      owner: REVIEWER_ROLE_LABELS[row.reviewer_role] ?? row.reviewer_role,
      due: addDays(row.created_at.slice(0, 10), SLA_DAYS[row.severity]),
      severity: row.severity,
    }));
}

export interface RiskRecentRow {
  domain: string;
  created_at: string;
}

/**
 * One row per domain with >= 1 open insight (rulings, RiskIndicator). `open`
 * is already the open list (new|reviewing|actioned); `recent` is any-status
 * rows from the last 14 days, used only for the trend split at `now`.
 */
export function toRiskIndicators(open: Insight[], recent: RiskRecentRow[], now: Date): RiskIndicator[] {
  const byDomain = new Map<string, Insight[]>();
  for (const row of open) {
    const group = byDomain.get(row.domain);
    if (group) group.push(row);
    else byDomain.set(row.domain, [row]);
  }

  const nowMs = now.getTime();
  const last7 = new Map<string, number>();
  const prev7 = new Map<string, number>();
  for (const row of recent) {
    const ageDays = Math.floor((nowMs - new Date(row.created_at).getTime()) / DAY_MS);
    if (ageDays < 0 || ageDays >= 14) continue;
    const bucket = ageDays < 7 ? last7 : prev7;
    bucket.set(row.domain, (bucket.get(row.domain) ?? 0) + 1);
  }

  const ranked: { indicator: RiskIndicator; n: number }[] = [];
  for (const [domain, rows] of byDomain) {
    const sorted = [...rows].sort(defaultOrder);
    const recentCount = last7.get(domain) ?? 0;
    const previousCount = prev7.get(domain) ?? 0;
    const trend: RiskIndicator["trend"] = recentCount > previousCount ? "up" : recentCount < previousCount ? "down" : "flat";
    ranked.push({
      indicator: {
        id: `risk:${domain}`,
        label: `${capitalize(domain)}: ${rows.length} open`,
        level: sorted[0].severity,
        trend,
        insight_id: sorted[0].id,
      },
      n: rows.length,
    });
  }

  return ranked
    .sort((a, b) => {
      if (SEVERITY_RANK[b.indicator.level] !== SEVERITY_RANK[a.indicator.level]) {
        return SEVERITY_RANK[b.indicator.level] - SEVERITY_RANK[a.indicator.level];
      }
      return b.n - a.n;
    })
    .slice(0, 6)
    .map((r) => r.indicator);
}

function confidenceBucket(c: number): "low" | "medium" | "high" {
  if (c >= 0.75) return "high";
  if (c >= 0.5) return "medium";
  return "low";
}

/** `insights.cards` — rulings, Cards. `rows` is the open list. */
export function toInsightCards(rows: Insight[], slug: string, limit: number): AIInsightCardProps[] {
  return [...rows]
    .sort(defaultOrder)
    .slice(0, limit)
    .map((row) => {
      const signalWhy = row.signal ? SIGNALS[row.signal as SignalKey]?.why : undefined;
      return {
        title: row.title,
        detected: row.pattern,
        whyItMatters: row.explanation?.why ?? signalWhy ?? row.pattern,
        evidence: row.evidence.map((e) => `${e.label}: ${e.value}${e.unit ?? ""}`),
        suggestedAction: { label: "Review insight", href: insightHref(slug, row.id) },
        requiresApproval: row.approval_required,
        confidence: confidenceBucket(row.confidence),
      };
    });
}

export async function priorityActions(ctx: TenantContext): Promise<PriorityAction[]> {
  const rows = await listInsights(ctx, { status: ["new", "reviewing"], limit: 200 });
  return toPriorityActions(rows, ctx.institution.slug, new Date());
}

export async function riskIndicators(ctx: TenantContext): Promise<RiskIndicator[]> {
  const now = new Date();
  const open = await listInsights(ctx, { status: ["new", "reviewing", "actioned"], limit: 200 });

  const supabase = await createClient();
  const cutoff = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("insights")
    .select("domain, created_at")
    .eq("institution_id", ctx.institution.id)
    .gte("created_at", cutoff);
  if (error) throw error;

  return toRiskIndicators(open, data ?? [], now);
}

export async function insightCards(ctx: TenantContext, input: InsightCardsInput): Promise<AIInsightCardProps[]> {
  const rows = await listInsights(ctx, { status: ["new", "reviewing", "actioned"], limit: 200 });
  return toInsightCards(rows, ctx.institution.slug, input.limit);
}
