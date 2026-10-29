import { Button } from "@/components/ui/button";
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
      <h1 className="text-xl font-semibold">Defaulters</h1>

      {terms.length > 0 && (
        <form className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <div>
            <label className="text-sm font-medium" htmlFor="termId">
              Term
            </label>
            <select id="termId" name="termId" defaultValue={termId} className="block rounded border border-input px-2 py-1 text-sm">
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      )}

      {termId ? (
        <DefaultersTable institutionSlug={institutionSlug} defaulters={defaulters} />
      ) : (
        <p className="text-muted-foreground text-sm">No terms set up yet.</p>
      )}
    </div>
  );
}
