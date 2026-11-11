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

/** One row of `dash_open_insight_domains`: a domain with open insights, its top insight, and 7-day creation counts. */
export interface OpenDomainRow {
  domain: string;
  n: number;
  top_id: string;
  top_severity: InsightSeverity;
  last7: number;
  prev7: number;
}

/** One row per domain with >= 1 open insight (rulings, RiskIndicator); counts come from SQL so they are exact at any size. */
export function toRiskIndicators(rows: OpenDomainRow[]): RiskIndicator[] {
  return rows
    .map((r) => {
      const trend: RiskIndicator["trend"] = r.last7 > r.prev7 ? "up" : r.last7 < r.prev7 ? "down" : "flat";
      return {
        n: r.n,
        indicator: {
          id: `risk:${r.domain}`,
          label: `${capitalize(r.domain)}: ${r.n} open`,
          level: r.top_severity,
          trend,
          insight_id: r.top_id,
        } satisfies RiskIndicator,
      };
    })
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
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dash_open_insight_domains", { p_institution_id: ctx.institution.id, p_now: new Date().toISOString() });
  if (error) throw error;
  return toRiskIndicators(
    (data ?? []).map((r) => ({ domain: r.domain, n: Number(r.n), top_id: r.top_id, top_severity: r.top_severity as InsightSeverity, last7: Number(r.last7), prev7: Number(r.prev7) })),
  );
}

export async function insightCards(ctx: TenantContext, input: InsightCardsInput): Promise<AIInsightCardProps[]> {
  const rows = await listInsights(ctx, { status: ["new", "reviewing", "actioned"], limit: 200 });
  return toInsightCards(rows, ctx.institution.slug, input.limit);
}
