import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { DefaultersTable } from "@/modules/finance/components/DefaultersTable";
import { listDefaulters, listTermOptions } from "@/modules/finance/queries";

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

  return (
    <div className="space-y-4">
      <PageHeader title="Defaulters" description="Students with unpaid or part-paid invoices." back={{ href: `/${institutionSlug}/finance`, label: "Finance" }} />

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
            <DefaultersTable institutionSlug={institutionSlug} defaulters={defaulters} />
          ) : (
            <EmptyState title="No terms set up yet" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
