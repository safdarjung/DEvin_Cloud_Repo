// Features-18 #3 — payslip render, shared by the payslip page's screen and
// print layouts (mirrors finance/components/ReceiptView.tsx). Pure rendering
// over the stored payslip snapshot (components copied at generation time).
import { LimitedBadge } from "@/components/honesty";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize, inr } from "@/lib/format";
import type { PayslipRow } from "@/modules/payroll/queries";
import { componentTotals, PAYROLL_LIMITED_NOTE } from "@/modules/payroll/schemas";

const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Integer paise -> "₹1,234.56". */
export const inrPaise = (paise: number): string => inr(paise / 100);

/** "2026-10-01" -> "October 2026". */
export const monthLabel = (month: string): string => monthFmt.format(new Date(`${month}T00:00:00Z`));

export function PayslipView({ payslip, schoolName }: { payslip: PayslipRow; schoolName: string }) {
  const earnings = payslip.components.filter((c) => c.kind === "earning");
  const deductions = payslip.components.filter((c) => c.kind === "deduction");
  const { deductionsPaise } = componentTotals(payslip.components);

  return (
    <div className="min-w-0 space-y-4 rounded-lg border bg-card p-4 text-card-foreground sm:p-6 print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
      <div className="flex items-start justify-between gap-3 border-b-2 border-border pb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{schoolName}</p>
          <h2 className="text-lg font-semibold">Payslip · {monthLabel(payslip.month)}</h2>
        </div>
        <div className="flex items-center gap-2">
          {payslip.runStatus === "draft" && <Badge variant="outline">Draft</Badge>}
          <LimitedBadge />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:w-96">
        <dt className="text-muted-foreground">Name</dt>
        <dd className="text-right">{payslip.staffName ?? "—"}</dd>
        <dt className="text-muted-foreground">Employee no</dt>
        <dd className="text-right">{payslip.employeeNo ?? "—"}</dd>
        <dt className="text-muted-foreground">Designation</dt>
        <dd className="text-right">{payslip.designation ? humanize(payslip.designation) : "—"}</dd>
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {earnings.map((c, i) => (
            <TableRow key={`e${i}`}>
              <TableCell>{c.name}</TableCell>
              <TableCell className="text-right tabular-nums">{inrPaise(c.amountPaise)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">Gross pay</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{inrPaise(payslip.grossPaise)}</TableCell>
          </TableRow>
          {deductions.map((c, i) => (
            <TableRow key={`d${i}`}>
              <TableCell>Less: {c.name}</TableCell>
              <TableCell className="text-right tabular-nums">−{inrPaise(c.amountPaise)}</TableCell>
            </TableRow>
          ))}
          {deductions.length > 0 && (
            <TableRow>
              <TableCell className="text-muted-foreground">Total deductions</TableCell>
              <TableCell className="text-right tabular-nums">−{inrPaise(deductionsPaise)}</TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell className="font-semibold">Net pay</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{inrPaise(payslip.netPaise)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <p className="text-muted-foreground text-xs">Computer-generated payslip from the school&apos;s salary register. {PAYROLL_LIMITED_NOTE}</p>
    </div>
  );
}
