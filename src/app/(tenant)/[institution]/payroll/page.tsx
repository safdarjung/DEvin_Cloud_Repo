import type { Metadata } from "next";
import Link from "next/link";
import { LimitedBadge } from "@/components/honesty";
import { ListPager } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { GenerateRunForm, SalaryStructureEditor } from "@/modules/payroll/components/PayrollForms";
import { inrPaise, monthLabel } from "@/modules/payroll/components/PayslipView";
import { payrollRuns, payrollStaffSalaries } from "@/modules/payroll/queries";
import { PAYROLL_LIMITED_NOTE } from "@/modules/payroll/schemas";

export const metadata: Metadata = { title: "Payroll" };

const STAFF_PAGE_SIZE = 25;

// Payroll register: salary structures per staff member and monthly runs
// (draft -> review -> finalize). payroll.manage = owner + accountant only.
export default async function PayrollPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ page?: string }> }) {
  const { institution: institutionSlug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "payroll");
  requirePermission(ctx, "payroll.manage");

  const [runsR, staffR] = await Promise.allSettled([payrollRuns(ctx), payrollStaffSalaries(ctx)]);
  for (const r of [runsR, staffR]) if (r.status === "rejected") console.error("payroll page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);

  const staff = staffR.status === "fulfilled" ? staffR.value : [];
  const withSalary = staff.filter((s) => s.structure).length;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageRows = staff.slice((page - 1) * STAFF_PAGE_SIZE, page * STAFF_PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" description="Salary structures, monthly payroll runs and payslips." />
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <LimitedBadge /> {PAYROLL_LIMITED_NOTE} Pay salaries through your bank as usual.
      </p>

      <section aria-labelledby="payroll-runs" className="space-y-3">
        <h2 id="payroll-runs" className="text-base font-semibold">
          Monthly runs
        </h2>
        <Card>
          <CardHeader>
            <CardTitle>Generate a month</CardTitle>
          </CardHeader>
          <CardContent>
            <GenerateRunForm institutionSlug={institutionSlug} />
          </CardContent>
        </Card>
        {runsR.status === "rejected" ? (
          <ErrorState title="Could not load payroll runs" description="Refresh to try again." />
        ) : runsR.value.length === 0 ? (
          <EmptyState title="No payroll runs yet" description="Generate a month above. It stays a draft until you finalize it." />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Payslips</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runsR.value.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{monthLabel(r.month)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "finalized" ? "success" : "outline"}>{humanize(r.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.payslipCount}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{inrPaise(r.grossPaise)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inrPaise(r.netPaise)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/${institutionSlug}/payroll/runs/${r.id}`}>{r.status === "draft" ? "Review" : "View"}</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="payroll-structures" className="space-y-3">
        <h2 id="payroll-structures" className="text-base font-semibold">
          Salary structures <span className="font-normal text-muted-foreground">({withSalary} of {staff.length} staff set)</span>
        </h2>
        {staffR.status === "rejected" ? (
          <ErrorState title="Could not load salary structures" description="Refresh to try again." />
        ) : staff.length === 0 ? (
          <EmptyState title="No active staff" description="Add staff members first, then set their monthly salary here." />
        ) : (
          <Card>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead className="hidden sm:table-cell">Designation</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((s) => (
                    <TableRow key={s.staffId}>
                      <TableCell>
                        <span className="font-medium">{s.fullName}</span>
                        <span className="block text-xs text-muted-foreground">{s.employeeNo}</span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{s.designation}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{s.structure ? inrPaise(s.structure.grossPaise) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.structure ? inrPaise(s.structure.netPaise) : <span className="text-muted-foreground">Not set</span>}</TableCell>
                      <TableCell className="text-right">
                        <SalaryStructureEditor institutionSlug={institutionSlug} staffId={s.staffId} staffName={s.fullName} components={s.structure?.components ?? []} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ListPager basePath={`/${institutionSlug}/payroll`} params={{}} page={page} total={staff.length} pageSize={STAFF_PAGE_SIZE} noun="staff" />
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
