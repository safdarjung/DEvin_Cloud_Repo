import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { BarList, RadialGauge } from "@/components/widgets/viz";
import { FadeIn } from "@/components/motion";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { usageSummary } from "@/modules/ai/queries";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "AI usage" };

const PROVIDER_ROWS = ["local", "cloud"] as const;

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

export default async function AiUsagePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.usage.read");

  const summary = await usageSummary(ctx);
  const okRequests = PROVIDER_ROWS.reduce((sum, p) => sum + summary.byProvider[p].okRequests, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI usage"
        description={`Last 30 days · ${summary.totalRequests} requests · ${summary.totalTokens.toLocaleString("en-IN")} tokens · ${formatUsd(summary.totalCostEstimateUsd)} (cost estimate, not a bill)`}
      />

      <KpiStrip className="xl:[&>div]:grid-cols-3">
        <KpiTile label="Requests" value={summary.totalRequests.toLocaleString("en-IN")} animateTo={summary.totalRequests} sub="Last 30 days" />
        <KpiTile label="Tokens" value={summary.totalTokens.toLocaleString("en-IN")} animateTo={summary.totalTokens} sub="Input and output" />
        <KpiTile label="Cost estimate" value={formatUsd(summary.totalCostEstimateUsd)} sub="Not a bill" />
      </KpiStrip>

      {summary.totalRequests > 0 && (
        <FadeIn className="grid gap-4 md:grid-cols-3">
          <Card className="min-w-0 md:col-span-2">
            <CardHeader>
              <CardTitle>Requests by provider</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                ariaLabel="Requests by provider, last 30 days"
                max={summary.totalRequests}
                items={PROVIDER_ROWS.map((provider) => ({
                  label: provider === "local" ? "Local" : "Cloud",
                  value: summary.byProvider[provider].requests,
                }))}
              />
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Success rate</CardTitle>
            </CardHeader>
            <CardContent>
              <RadialGauge
                value={(okRequests / summary.totalRequests) * 100}
                label="Successful requests"
                sublabel={`${okRequests} of ${summary.totalRequests}`}
                thresholds={{ good: 95, warn: 80 }}
              />
            </CardContent>
          </Card>
        </FadeIn>
      )}

      <Card>
        <CardHeader>
          <CardTitle>By provider</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Successful</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Input tokens</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Output tokens</TableHead>
                <TableHead className="text-right">Cost estimate (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PROVIDER_ROWS.map((provider) => {
                const row = summary.byProvider[provider];
                return (
                  <TableRow key={provider}>
                    <TableCell className="capitalize">{provider}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.requests}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{row.okRequests}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{row.inputTokens.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{row.outputTokens.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(row.costEstimateUsd)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Cost figures are estimates from a static price table (never a provider bill). Concurrency limits are
        enforced per server process, not globally across instances.
      </p>
    </div>
  );
}
