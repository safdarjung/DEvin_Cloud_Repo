import type { Metadata } from "next";
import Link from "next/link";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const canManageStructures = hasPermission(ctx, "finance.structure.manage");

  return (
    <div className="space-y-4">
      <PageHeader title="Finance" description="Fee structures, invoices and payments." />
      <Stagger className="grid gap-4 sm:grid-cols-2">
        {canManageStructures && (
          <StaggerItem className="h-full motion-safe:fill-mode-backwards">
          <Link href={`/${institutionSlug}/finance/structures`} className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-[background-color,border-color,transform] duration-(--duration-fast) hover:border-ring/60 hover:bg-muted/50 active:scale-[0.99]">
              <CardHeader>
                <CardTitle>Fee structures &amp; assignments</CardTitle>
                <CardDescription>Per-grade fee components and student assignments.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
          </StaggerItem>
        )}
        <StaggerItem className="h-full motion-safe:fill-mode-backwards">
        <Link href={`/${institutionSlug}/finance/invoices`} className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-[background-color,border-color,transform] duration-(--duration-fast) hover:border-ring/60 hover:bg-muted/50 active:scale-[0.99]">
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>View invoices and record payments.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
