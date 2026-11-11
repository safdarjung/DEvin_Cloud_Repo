import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, ProgressBar } from "@/components/widgets/viz";
import { inr } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { BulkActions } from "@/modules/finance/components/BulkActions";
import { DefaultersTable } from "@/modules/finance/components/DefaultersTable";
import { listDefaulters, listTermOptions } from "@/modules/finance/queries";
import { aiTaskOn } from "@/modules/ai/task-route";

// T-032 — 06 §W9 defaulters list (AC4). Same staff-only gate as the ledger
// page — `finance.structure.manage` matches `app.finance_roles()`, the role
// set that can actually see unpaid balances; `finance.read` alone would
// also let a guardian/student load this page.
export default async function DefaultersPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ termId?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { termId: requestedTermId } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.structure.manage");

  const terms = await listTermOptions(ctx);
  const termId = requestedTermId ?? terms[0]?.id;
  const defaulters = termId ? await listDefaulters(ctx, { termId }) : [];
  const canRemind = hasPermission(ctx, "finance.reminder.send") && isModuleEnabled(ctx, "finance_plus") && defaulters.length > 0;
  const aiDraftTermId = termId && aiTaskOn(ctx, "fee_reminder_writer") ? termId : undefined;

  // Derived only from the rows above (unpaid / part-paid invoices this term).
  const billed = defaulters.reduce((sum, d) => sum + d.total, 0);
  const paid = defaulters.reduce((sum, d) => sum + d.paidTotal, 0);
  const outstanding = defaulters.reduce((sum, d) => sum + d.outstanding, 0);
  const largest = [...defaulters]
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5)
    .map((d) => ({
      label: d.studentName,
      value: d.outstanding,
      href: `/${institutionSlug}/finance/invoices/${d.invoiceId}`,
      tone: "warning" as const,
    }));

  return (
    <div className="space-y-4">
      <PageHeader title="Defaulters" description="Students with unpaid or part-paid invoices." back={{ href: `/${institutionSlug}/finance`, label: "Finance" }} />

      {defaulters.length > 0 && (
        <FadeIn className="grid gap-4 lg:grid-cols-3">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Collected on these invoices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProgressBar
                value={paid}
                max={billed}
                label={`${defaulters.length} open invoice${defaulters.length === 1 ? "" : "s"}`}
                valueLabel={`${inr(paid)} of ${inr(billed)}`}
                tone="warning"
              />
              <p className="text-sm text-muted-foreground">
                Outstanding <span className="font-semibold text-foreground tabular-nums">{inr(outstanding)}</span>
              </p>
            </CardContent>
          </Card>
          <Card className="min-w-0 lg:col-span-2">
            <CardHeader>
              <CardTitle>Largest balances</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              <BarList items={largest} format="inr" ariaLabel="Largest outstanding balances" />
            </CardContent>
          </Card>
        </FadeIn>
      )}

      <Card>
        {terms.length > 0 && (
          <form className="flex flex-col gap-3 border-b-2 border-border px-4 pb-3 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <Label className="mb-1 block" htmlFor="termId">
                Term
              </Label>
              <Select name="termId" defaultValue={termId}>
                <SelectTrigger id="termId" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" variant="outline" className="w-full sm:w-auto">
              Filter
            </Button>
          </form>
        )}

        <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
          {termId ? (
            canRemind ? (
              <BulkActions kind="remind" institutionSlug={institutionSlug}>
                <DefaultersTable institutionSlug={institutionSlug} defaulters={defaulters} selectable aiDraftTermId={aiDraftTermId} />
              </BulkActions>
            ) : (
              <DefaultersTable institutionSlug={institutionSlug} defaulters={defaulters} aiDraftTermId={aiDraftTermId} />
            )
          ) : (
            <EmptyState title="No terms set up yet" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
