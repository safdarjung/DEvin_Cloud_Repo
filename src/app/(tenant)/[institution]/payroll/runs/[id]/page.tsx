import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LimitedBadge } from "@/components/honesty";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { FinalizeRunButton, RebuildRunButton } from "@/modules/payroll/components/PayrollForms";
import { inrPaise, monthLabel } from "@/modules/payroll/components/PayslipView";
import { payrollRunDetail } from "@/modules/payroll/queries";
import { PayrollRunIdSchema } from "@/modules/payroll/schemas";

export const metadata: Metadata = { title: "Payroll run" };

// Review one month: every payslip, then rebuild (draft only) or finalize with a confirm step.
export default async function PayrollRunPage({ params }: { params: Promise<{ institution: string; id: string }> }) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "payroll");
  requirePermission(ctx, "payroll.manage");
  if (!PayrollRunIdSchema.safeParse({ runId: id }).success) notFound();

  const detail = await payrollRunDetail(ctx, id);
  if (!detail) notFound();
  const { run, payslips } = detail;
  const label = monthLabel(run.month);
  const isDraft = run.status === "draft";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payroll · ${label}`}
        crumb={label}
        back={{ href: `/${institutionSlug}/payroll`, label: "Payroll" }}
        description={isDraft ? "Draft. Review every payslip, rebuild after salary changes, then finalize." : "Finalized. Payslips are final and visible to each staff member."}
        actions={
          isDraft ? (
            <>
              <RebuildRunButton institutionSlug={institutionSlug} month={run.month.slice(0, 7)} />
              <FinalizeRunButton institutionSlug={institutionSlug} runId={run.id} label={label} payslipCount={payslips.length} />
            </>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={isDraft ? "outline" : "success"}>{humanize(run.status)}</Badge>
        <span className="tabular-nums">
          {run.payslipCount} payslips · gross {inrPaise(run.grossPaise)} · net {inrPaise(run.netPaise)}
        </span>
        <LimitedBadge />
      </div>

      {payslips.length === 0 ? (
        <EmptyState title="No payslips in this run" description="Set salary structures for active staff on the payroll page, then rebuild this draft." />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Gross</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Deductions</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="font-medium">{p.staffName ?? "—"}</span>
                      <span className="block text-xs text-muted-foreground">{p.designation}</span>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{inrPaise(p.grossPaise)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{inrPaise(p.grossPaise - p.netPaise)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inrPaise(p.netPaise)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${institutionSlug}/payroll/payslips/${p.id}`}>Payslip</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
