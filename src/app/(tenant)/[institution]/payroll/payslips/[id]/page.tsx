import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { PrintButton } from "@/modules/payroll/components/PayrollForms";
import { PayslipView } from "@/modules/payroll/components/PayslipView";
import { payslipGet } from "@/modules/payroll/queries";
import { PayslipGetSchema } from "@/modules/payroll/schemas";

export const metadata: Metadata = { title: "Payslip" };

// Payslip screen + print layout (pattern: finance/receipts/[id]/print). The
// tenant layout always renders <header>/<nav aria-label="Primary">; the
// scoped @media print rule hides them so only the payslip reaches paper.
// payslip.read: RLS returns only the caller's own payslips of finalized
// months to non-managers, so any other id is a 404.
export default async function PayslipPage({ params }: { params: Promise<{ institution: string; id: string }> }) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "payroll");
  requirePermission(ctx, "payslip.read");
  if (!PayslipGetSchema.safeParse({ payslipId: id }).success) notFound();

  const payslip = await payslipGet(ctx, id);
  if (!payslip) notFound();
  const back = hasPermission(ctx, "payroll.manage") ? `/${institutionSlug}/payroll/runs/${payslip.runId}` : `/${institutionSlug}/me`;

  return (
    <div className="mx-auto max-w-2xl print:max-w-none">
      <style>{`
        @media print {
          header, nav[aria-label="Primary"] { display: none !important; }
        }
      `}</style>
      <div className="mb-4 flex gap-2 print:hidden">
        <Button variant="outline" asChild>
          <Link href={back}>Back</Link>
        </Button>
        <PrintButton />
      </div>
      <PayslipView payslip={payslip} schoolName={ctx.institution.name} />
    </div>
  );
}
