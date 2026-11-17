import type { Metadata } from "next";
import Link from "next/link";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import type { Permission } from "@/lib/auth/permissions";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules/catalog";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  // Same gates as each target page (and nav.ts): a card shows only when its page would open for this role.
  const can = (permission: Permission, module?: ModuleKey) => hasPermission(ctx, permission) && (!module || isModuleEnabled(ctx, module));
  const cards = [
    { href: "invoices", title: "Invoices", body: "View invoices and record payments.", show: true },
    { href: "defaulters", title: "Defaulters", body: "Unpaid and overdue invoices; send reminders.", show: can("finance.structure.manage") },
    { href: "ledger", title: "Ledger", body: "Double-entry postings by date range.", show: can("finance.structure.manage") },
    { href: "structures", title: "Fee structures & assignments", body: "Per-grade fee components and student assignments.", show: can("finance.structure.manage") },
    { href: "fee-plans", title: "Fee plans", body: "Late-fee rules, instalment plans and ledger export.", show: can("finance.plan.manage", "fee_plans") },
    { href: "concessions", title: "Concessions", body: "Scholarship and concession rules and awards.", show: can("concession.read", "scholarships") },
    { href: "expenses", title: "Expenses", body: "School spending against budgets.", show: can("expense.read", "expenses") },
  ].filter((c) => c.show);

  return (
    <div className="space-y-4">
      <PageHeader title="Finance" description="Fee structures, invoices and payments." />
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <StaggerItem key={c.href} className="h-full motion-safe:fill-mode-backwards">
            <Link href={`/${institutionSlug}/finance/${c.href}`} className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-[background-color,border-color,transform] duration-(--duration-fast) hover:border-ring/60 hover:bg-muted/50 active:scale-[0.99]">
                <CardHeader>
                  <CardTitle>{c.title}</CardTitle>
                  <CardDescription>{c.body}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
