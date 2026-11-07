import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { usageSummary } from "@/modules/ai/queries";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI usage"
        description={`Last 30 days · ${summary.totalRequests} requests · ${summary.totalTokens.toLocaleString()} tokens · ${formatUsd(summary.totalCostEstimateUsd)} (cost estimate, not a bill)`}
      />

      <KpiStrip className="xl:[&>div]:grid-cols-3">
        <KpiTile label="Requests" value={summary.totalRequests.toLocaleString()} sub="Last 30 days" />
        <KpiTile label="Tokens" value={summary.totalTokens.toLocaleString()} sub="Input and output" />
        <KpiTile label="Cost estimate" value={formatUsd(summary.totalCostEstimateUsd)} sub="Not a bill" />
      </KpiStrip>

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
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{row.inputTokens.toLocaleString()}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{row.outputTokens.toLocaleString()}</TableCell>
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
        enforced per server process, not globally across instances (DBT-02).
      </p>
    </div>
  );
}
