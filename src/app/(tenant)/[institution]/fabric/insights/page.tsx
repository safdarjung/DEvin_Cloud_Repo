import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listInsightActions, listInsights } from "@/modules/insights/queries";
import { InsightDetail, InsightFilters, InsightList } from "@/modules/insights/components/insight-view";
import { parseDomain, parseStatusTab, parseUuid, sortInsights, insightHref } from "@/modules/insights/components/helpers";

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ status?: string; domain?: string; id?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "insight.read");

  const base = `/${slug}/fabric/insights`;
  const header = (
    <PageHeader
      title="Insights"
      description="Patterns found in your school's data. Facts are computed by rules; AI only explains them."
    />
  );

  if (!isModuleEnabled(ctx, "insights")) {
    return (
      <div data-fabric-ws="insights">
        {header}
        <EmptyState
          title="Insights are turned off"
          description="Enable the Insights module in Settings, Modules to start seeing early-warning patterns."
          action={
            hasPermission(ctx, "institution.settings.manage") ? (
              <Button asChild variant="outline">
                <Link href={`/${slug}/settings/modules`}>Open module settings</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const tab = parseStatusTab(sp.status);
  const domain = parseDomain(sp.domain);
  const id = parseUuid(sp.id);

  const [listRes, actionsRes] = await Promise.allSettled([
    listInsights(ctx, { status: [...tab.statuses], domain, limit: 50 }),
    id ? listInsightActions(ctx, id) : Promise.resolve([]),
  ]);

  const items = listRes.status === "fulfilled" ? sortInsights(listRes.value) : [];
  let selected = id ? items.find((i) => i.id === id) : undefined;
  if (id && !selected) {
    // Card links carry only ?id=, so the row may sit outside the current tab/domain/limit.
    const all = await listInsights(ctx, { status: ["new", "reviewing", "actioned", "resolved", "dismissed"], limit: 200 }).catch(() => []);
    selected = all.find((i) => i.id === id);
  }
  const backHref = insightHref(base, { status: tab.key, domain });

  return (
    <div data-fabric-ws="insights" className="space-y-4">
      {header}
      <InsightFilters base={base} status={tab.key} domain={domain} />
      {listRes.status === "rejected" ? (
        <ErrorState
          title="Could not load insights"
          description="Reload the page to try again."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className={selected ? "hidden lg:block" : undefined}>
            <InsightList base={base} status={tab.key} domain={domain} items={items} selectedId={id} />
          </div>
          <div className={selected ? undefined : "hidden lg:block"}>
            {selected ? (
              <InsightDetail
                institutionSlug={slug}
                backHref={backHref}
                insight={selected}
                actions={actionsRes.status === "fulfilled" ? actionsRes.value : []}
                actionsFailed={actionsRes.status === "rejected"}
                canReview={hasPermission(ctx, "insight.review")}
                canExplain={hasPermission(ctx, "ai.generate")}
              />
            ) : (
              <EmptyState
                title={id ? "Insight not in this view" : "Pick an insight"}
                description={id ? "It may be filtered out or you may not have access. Change the filters." : "Select an insight to see its evidence and history."}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
