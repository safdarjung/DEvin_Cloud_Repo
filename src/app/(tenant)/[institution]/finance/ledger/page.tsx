import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { LedgerTable } from "@/modules/finance/components/LedgerTable";
import { listLedgerEntries } from "@/modules/finance/queries";

const LEDGER_ACCOUNTS = ["cash", "bank", "fees_receivable", "fee_income", "concession_expense"] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// T-032 — 06 §W9 ledger view (AC4). `finance.structure.manage` is granted
// to exactly owner/principal/admin/accountant (07 §2.2) — the same role set
// as `app.finance_roles()`, which `ledger_entries_select` gates on (05 §5:
// "not in that list" for guardian/student own-scope) — so this permission,
// not the broader guardian/student-inclusive `finance.read`, is the page
// gate that actually matches the RLS boundary.
export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ from?: string; to?: string; account?: string; page?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { from, to, account, page } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.structure.manage");

  const range = { from: from ?? firstOfMonthIso(), to: to ?? todayIso(), account: account || undefined };
  const pageNum = Number(page) || 1;
  const ledger = await listLedgerEntries(ctx, range, pageNum);

  const hasMore = ledger.page * ledger.pageSize < ledger.totalCount;
  const query = (p: number) =>
    `?from=${range.from}&to=${range.to}${range.account ? `&account=${range.account}` : ""}&page=${p}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Ledger</h1>

      <form className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
        <div>
          <label className="text-sm font-medium" htmlFor="from">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={range.from} className="block rounded border border-input px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="to">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={range.to} className="block rounded border border-input px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="account">
            Account
          </label>
          <select id="account" name="account" defaultValue={range.account ?? ""} className="block rounded border border-input px-2 py-1 text-sm">
            <option value="">All</option>
            {LEDGER_ACCOUNTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <LedgerTable ledger={ledger} />

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={ledger.page <= 1} asChild={ledger.page > 1}>
          {ledger.page > 1 ? <Link href={query(ledger.page - 1)}>Previous</Link> : <span>Previous</span>}
        </Button>
        <Button variant="outline" disabled={!hasMore} asChild={hasMore}>
          {hasMore ? <Link href={query(ledger.page + 1)}>Next</Link> : <span>Next</span>}
        </Button>
      </div>
    </div>
  );
}
