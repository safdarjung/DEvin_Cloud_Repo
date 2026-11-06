import { inr } from "@/lib/format";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { StudentInvoices } from "@/modules/finance/components/StudentInvoices";
import { listReceiptsForStudent } from "@/modules/finance/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";


export default async function PortalFeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/fees`);
  const receipts = await listReceiptsForStudent(ctx, selection.studentId);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/fees"
        canStudy={hasPermission(ctx, "ai.study")}
      />

      <div className="space-y-4">
        <StudentInvoices ctx={ctx} institutionSlug={institutionSlug} studentId={selection.studentId}
          payOnline={ctx.membership.role === "guardian" && hasPermission(ctx, "finance.payment.online")}
        />

        {receipts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Receipts</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link
                      href={`/${institutionSlug}/portal/fees/receipts/${r.id}?student=${selection.studentId}`}
                      className="inline-flex min-h-10 items-center font-medium underline-offset-2 hover:underline"
                    >
                      {r.receiptNo}
                    </Link>
                    <span className="tabular-nums text-muted-foreground">{inr(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
