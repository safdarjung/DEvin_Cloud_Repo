// T-028 — 06 §W4 step 5 / 08 §4 J-05, J-07: the staff student profile.
// Composes the existing attendance summary with this module's own
// header/guardians/invoices pieces. Report cards (exams) are omitted —
// T-019's ReportCard component doesn't exist in this tree yet.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LimitedBadge } from "@/components/honesty";
import type { TenantContext } from "@/lib/auth/types";
import { StudentAttendanceSummary } from "@/modules/attendance/components/StudentAttendanceSummary";
import type { InvoiceSummary } from "@/modules/finance/queries";
import { GuardiansCard } from "@/modules/people/components/GuardiansCard";
import { StudentProfileHeader } from "@/modules/people/components/StudentProfileHeader";
import type { StudentProfile as StudentProfileData } from "@/modules/people/queries";

interface StudentProfileProps {
  ctx: TenantContext;
  student: StudentProfileData;
  invoices: InvoiceSummary[];
  termId: string | null;
}

export function StudentProfile({ ctx, student, invoices, termId }: StudentProfileProps) {
  const name = [student.firstName, student.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      <StudentProfileHeader student={student} />

      <div className="grid gap-4 sm:grid-cols-2">
        <GuardiansCard guardians={student.guardians} />
        {termId && <StudentAttendanceSummary ctx={ctx} studentId={student.id} termId={termId} studentName={name} />}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Invoices</CardTitle>
          {invoices.length > 0 && (
            <div className="flex items-center gap-2">
              <LimitedBadge />
              <span className="text-muted-foreground text-xs">Full-term invoices only (no pro-rating yet)</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Due on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>{invoice.invoiceNo}</TableCell>
                    <TableCell>{invoice.status}</TableCell>
                    <TableCell>{invoice.total.toFixed(2)}</TableCell>
                    <TableCell>{invoice.paidTotal.toFixed(2)}</TableCell>
                    <TableCell>{invoice.dueOn ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
