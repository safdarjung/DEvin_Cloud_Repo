// Server components for the insights workspace: filters, list, detail.
// Observed facts (detector output) and the AI explanation are rendered in
// visibly separate sections; AI text is always labelled.
import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowLeft, Eye, Info, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import type { Insight, InsightAction, InsightSeverity } from "@/modules/fabric/types";
import { InsightControls } from "./insight-controls";
import {
  INSIGHT_DOMAINS,
  STATUS_TABS,
  capitalize,
  confidencePct,
  formatDate,
  insightHref,
} from "./helpers";

const SEVERITY: Record<InsightSeverity, { label: string; variant: "info" | "secondary" | "warning" | "destructive"; Icon: typeof Info }> = {
  info: { label: "Info", variant: "info", Icon: Info },
  watch: { label: "Watch", variant: "secondary", Icon: Eye },
  warning: { label: "Warning", variant: "warning", Icon: AlertTriangle },
  critical: { label: "Critical", variant: "destructive", Icon: AlertOctagon },
};

export function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const { label, variant, Icon } = SEVERITY[severity];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}

const chip =
  "inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9";

export function InsightFilters({ base, status, domain }: { base: string; status: string; domain?: string }) {
  return (
    <div className="space-y-2">
      <nav aria-label="Insight status" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {STATUS_TABS.map((t) => {
          const active = t.key === status;
          return (
            <Link
              key={t.key}
              href={insightHref(base, { status: t.key, domain })}
              aria-current={active ? "page" : undefined}
              className={`${chip} ${active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Insight domain" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {[undefined, ...INSIGHT_DOMAINS].map((d) => {
          const active = d === domain;
          return (
            <Link
              key={d ?? "all"}
              href={insightHref(base, { status, domain: d })}
              aria-current={active ? "page" : undefined}
              className={`${chip} ${active ? "border-foreground bg-muted font-medium" : "hover:bg-muted"}`}
            >
              {d ? capitalize(d) : "All domains"}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function InsightList({
  base,
  status,
  domain,
  items,
  selectedId,
}: {
  base: string;
  status: string;
  domain?: string;
  items: Insight[];
  selectedId?: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No insights here"
        description="Nothing matches this filter. Insights appear when a detector finds a pattern in your school's data."
      />
    );
  }
  return (
    <ul className="space-y-2" aria-label="Insights">
      {items.map((i) => {
        const selected = i.id === selectedId;
        return (
          <li key={i.id}>
            <Link
              href={insightHref(base, { status, domain, id: i.id })}
              aria-current={selected ? "true" : undefined}
              className={`block min-h-11 rounded-xl border p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-muted" : "hover:bg-muted/60"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={i.severity} />
                <Badge variant="outline">{capitalize(i.domain)}</Badge>
                <Badge variant="ghost">{capitalize(i.status)}</Badge>
              </div>
              <p className="mt-2 font-medium">{i.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{i.pattern}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Detector confidence {confidencePct(i.confidence)}%
                {i.entity_ref ? ` · ${i.entity_ref.label}` : ""}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function InsightDetail({
  institutionSlug,
  backHref,
  insight,
  actions,
  actionsFailed,
  canReview,
  canExplain,
}: {
  institutionSlug: string;
  backHref: string;
  insight: Insight;
  actions: InsightAction[];
  actionsFailed: boolean;
  canReview: boolean;
  canExplain: boolean;
}) {
  const ex = insight.explanation;
  return (
    <article className="space-y-4" aria-labelledby="insight-title">
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden /> All insights
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={insight.severity} />
          <Badge variant="outline">{capitalize(insight.domain)}</Badge>
          <Badge variant="outline">{capitalize(insight.kind)}</Badge>
          <Badge variant="secondary">{capitalize(insight.status)}</Badge>
        </div>
        <h2 id="insight-title" className="text-lg font-semibold">{insight.title}</h2>
        <InsightControls
          institutionSlug={institutionSlug}
          insightId={insight.id}
          status={insight.status}
          canReview={canReview}
          canExplain={canExplain}
        />
      </header>

      <Section title="Observed facts" hint="Computed from your data by a rule-based detector, not by AI.">
        <p className="text-sm">{insight.pattern}</p>
        {insight.evidence.length > 0 && (
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {insight.evidence.map((e) => (
              <div key={e.label} className="rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">{e.label}</dt>
                <dd className="font-medium">
                  {e.value}
                  {e.unit ? ` ${e.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Period {formatDate(insight.date_from)} to {formatDate(insight.date_to)}
          {insight.sources.length > 0 ? ` · Sources: ${insight.sources.join(", ")}` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Detector confidence {confidencePct(insight.confidence)}%. A heuristic score, not a probability.
        </p>
        {insight.factors.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium">Possible contributing factors (hypotheses, not causes)</p>
            <ul className="mt-1 space-y-1 text-sm">
              {insight.factors.map((f) => (
                <li key={f.label} className="flex items-center justify-between gap-2">
                  <span>{f.label}</span>
                  <span className="text-muted-foreground">{Math.round(f.weight * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {insight.recommended_actions.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium">Suggested next steps (rule-based)</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {insight.recommended_actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Review by: {insight.reviewer_role}
          {insight.approval_required ? " · Approval required" : ""}
        </p>
      </Section>

      <Section title="AI-generated suggestion" hint="Written by an AI model from the facts above. Check it before acting; it never changes the insight status.">
        {ex ? (
          <div className="space-y-2 text-sm">
            <p className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden /> AI-generated suggestion ·{" "}
              {ex.provider === "local" ? "run locally" : "cloud model"}
              {ex.model ? ` (${ex.model})` : ""}
              {ex.explained_at ? ` · ${formatDate(ex.explained_at)}` : ""}
            </p>
            <p><span className="font-medium">What: </span>{ex.what}</p>
            <p><span className="font-medium">Why: </span>{ex.why}</p>
            <ul className="list-disc space-y-1 pl-5">
              {ex.next_steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No AI explanation yet.{canExplain ? " Use Explain with AI above to generate one." : ""}
          </p>
        )}
      </Section>

      <Section title="Action history" hint="Actions your team recorded for this insight.">
        {actionsFailed ? (
          <p role="alert" className="text-sm text-destructive">Could not load actions. Refresh to retry.</p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actions recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {actions.map((a) => (
              <li key={a.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{a.action}</span>
                  <Badge variant="secondary">{capitalize(a.status)}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">Owner: {a.owner} · {formatDate(a.decided_at)}</p>
                <p className="mt-1">{a.rationale}</p>
                <p className="mt-1 text-muted-foreground">Expected: {a.expected_outcome}</p>
                {a.actual_outcome && <p className="mt-1">Actual: {a.actual_outcome}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </article>
  );
}
