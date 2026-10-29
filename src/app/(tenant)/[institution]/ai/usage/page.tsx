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
      <div>
        <h1 className="text-xl font-semibold">AI usage</h1>
        <p className="text-muted-foreground text-sm">
          Last 30 days · {summary.totalRequests} requests · {summary.totalTokens.toLocaleString()} tokens ·{" "}
          {formatUsd(summary.totalCostEstimateUsd)} (cost estimate, not a bill)
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Requests</TableHead>
            <TableHead>Successful</TableHead>
            <TableHead>Input tokens</TableHead>
            <TableHead>Output tokens</TableHead>
            <TableHead>Cost estimate (USD)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {PROVIDER_ROWS.map((provider) => {
            const row = summary.byProvider[provider];
            return (
              <TableRow key={provider}>
                <TableCell className="capitalize">{provider}</TableCell>
                <TableCell>{row.requests}</TableCell>
                <TableCell>{row.okRequests}</TableCell>
                <TableCell>{row.inputTokens.toLocaleString()}</TableCell>
                <TableCell>{row.outputTokens.toLocaleString()}</TableCell>
                <TableCell>{formatUsd(row.costEstimateUsd)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="text-muted-foreground text-xs">
        Cost figures are estimates from a static price table (never a provider bill). Concurrency limits are
        enforced per server process, not globally across instances (DBT-02).
      </p>
    </div>
  );
}
