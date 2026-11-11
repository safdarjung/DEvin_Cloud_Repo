// Features-18 #3 — "My payslips" section of /me (server component). Own
// payslips of finalized months only (RLS + myPayslips filter).
import Link from "next/link";
import { LimitedBadge } from "@/components/honesty";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TenantContext } from "@/lib/auth/types";
import { inrPaise, monthLabel } from "@/modules/payroll/components/PayslipView";
import { myPayslips, type MyPayslipRow } from "@/modules/payroll/queries";
import { PAYROLL_LIMITED_NOTE } from "@/modules/payroll/schemas";

export async function MyPayslips({ ctx }: { ctx: TenantContext }) {
  let rows: MyPayslipRow[] | null = null;
  try {
    rows = await myPayslips(ctx);
  } catch (err) {
    console.error("my payslips fetch failed:", err instanceof Error ? err.message : err);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          My payslips <LimitedBadge />
        </CardTitle>
        <p className="text-sm text-muted-foreground">{PAYROLL_LIMITED_NOTE}</p>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <ErrorState title="Could not load your payslips" description="Refresh to try again." />
        ) : rows.length === 0 ? (
          <EmptyState bare title="No payslips yet" description="Your payslip appears here once the school finalizes a month's payroll." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{monthLabel(p.month)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{inrPaise(p.grossPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inrPaise(p.netPaise)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/${ctx.institution.slug}/payroll/payslips/${p.id}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
