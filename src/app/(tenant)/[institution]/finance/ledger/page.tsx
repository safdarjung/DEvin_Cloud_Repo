import { Label } from "@/components/ui/label";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  const range = { from: from ?? firstOfMonthIso(), to: to ?? todayIso(), account: account && account !== "all" ? account : undefined };
  const pageNum = Number(page) || 1;
  const ledger = await listLedgerEntries(ctx, range, pageNum);

  const hasMore = ledger.page * ledger.pageSize < ledger.totalCount;
  const query = (p: number) =>
    `?from=${range.from}&to=${range.to}${range.account ? `&account=${range.account}` : ""}&page=${p}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Ledger" description="Double-entry postings for the selected range." back={{ href: `/${institutionSlug}/finance`, label: "Finance" }} />

      <Card>
      <form className="grid gap-3 border-b-2 border-border px-4 pb-3 sm:flex sm:flex-wrap sm:items-end">
        <div>
          <Label className="mb-1 block" htmlFor="from">
            From
          </Label>
          <Input id="from" name="from" type="date" defaultValue={range.from} />
        </div>
        <div>
          <Label className="mb-1 block" htmlFor="to">
            To
          </Label>
          <Input id="to" name="to" type="date" defaultValue={range.to} />
        </div>
        <div>
          <Label className="mb-1 block" htmlFor="account">
            Account
          </Label>
          <Select name="account" defaultValue={range.account ?? "all"}>
            <SelectTrigger id="account" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {LEDGER_ACCOUNTS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="outline" className="w-full sm:w-auto">
          Filter
        </Button>
      </form>

      <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
        <LedgerTable ledger={ledger} />
      </CardContent>
      </Card>

      <nav aria-label="Pagination" className="flex justify-end gap-2">
        <Button variant="outline" disabled={ledger.page <= 1} asChild={ledger.page > 1}>
          {ledger.page > 1 ? <Link href={query(ledger.page - 1)}>Previous</Link> : <span>Previous</span>}
        </Button>
        <Button variant="outline" disabled={!hasMore} asChild={hasMore}>
          {hasMore ? <Link href={query(ledger.page + 1)}>Next</Link> : <span>Next</span>}
        </Button>
      </nav>
    </div>
  );
}
